/** 
 *        Copyright 2010 Johan Dahlberg. All rights reserved.
 *
 *  Redistribution and use in source and binary forms, with or without 
 *  modification, are permitted provided that the following conditions 
 *  are met:
 *
 *    1. Redistributions of source code must retain the above copyright notice, 
 *       this list of conditions and the following disclaimer.
 *
 *    2. Redistributions in binary form must reproduce the above copyright 
 *       notice, this list of conditions and the following disclaimer in the 
 *       documentation and/or other materials provided with the distribution.
 *
 *  THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, 
 *  INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY 
 *  AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL 
 *  THE AUTHORS OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, 
 *  SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED 
 *  TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR 
 *  PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF 
 *  LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING 
 *  NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, 
 *  EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 */

const inherits            = require("util").inherits
    , EventEmitter        = require("events").EventEmitter
    , Buffer              = require("buffer").Buffer

var proxy                 = {};


function MemStream(remoteStream) {

  this._remoteStream = remoteStream || null;
  this._connecting = false;
  this._address = null;
  this._decoder = null;
  this._paused = false;
  
  this._recvQueue = null;
  
  this.type = "mem";
  this.readable = (this._remoteStream && true) || false;
  this.writable = (this._remoteStream && true) || false;
}

exports.MemStream = MemStream;
inherits(MemStream, EventEmitter);

/**
 *  ### memstream.readyState
 *  
 *  Either `'closed'`, `'open'` pr `'opening'`.
 */
Object.defineProperty(MemStream.prototype, 'readyState', {
  get: function () {
    if (this._connecting) {
      return 'opening';
    } else if (this.readable && this.writable) {
      return 'open';
    } else {
      return 'closed';
    }
  }
});

/**
 *  ### memstream.connect(address)
 *
 *  Opens a stream to the specified `address`. `createConnection()`
 *  also opens a stream; normally this method is not needed. Use this only if
 *  a stream is closed and you want to reuse the object to connect to another
 *  memserver.
 *
 *  This function is asynchronous. When the `'connect'` event is emitted the
 *  stream is established. If there is a problem connecting, the `'connect'`
 *  event will not be emitted, the `'error'` event will be emitted with 
 *  the exception.
 */
MemStream.prototype.connect = function (address) {
  var self = this;
  
  if (self._remoteStream || self._address) {
    throw new Error("MemStream is already connected");
  }
  
  if (!proxyExists(address)) {
    self.destroy(new Error("MemStream does not exist"));
  } else {
    self._connecting = true;
    proxyLink(address, self, function(remoteStream) {
      self._remoteStream = remoteStream;
      self.readable = true;
      self.writable = true;
      self._connecting = false;
      
      self._remoteStream.on("close", function() {
        self.destroy();
      });
      
      self.emit("connect");
    });
  }
  
  self._address = address;  
}

/**
 *  ### memstream.pause()
 *
 *  Pauses the incoming 'data' events.
 */
MemStream.prototype.pause = function () {
  if (!this._paused) {
    this._paused = true;
    this._recvQueue = [];
  }
}

/**
 *  ### memstream.resume()
 * 
 *  Resumes the incoming 'data' events after a pause().
 */
MemStream.prototype.resume = function () {
  if (!this._paused) return;
  var self = this;
  var next = (self._recvQueue && self._recvQueue.length 
              && self._recvQueue.pop()) || (self._recvQueue = null);

  self._paused = false;
  
  if (next) {
    self._ondata(next);
  }
}

MemStream.prototype.address = function () {
  return this._address;
}

/**
 *  ### memstream.setNoDelay()
 *
 *  The method ´setNoDelay´ is simple ignore in memstream
 */
MemStream.prototype.setNoDelay = function (v) { }

/**
 *  ### memstream.setKeepAlive()
 *
 *  The method ´setKeepAlive´ is simple ignore in memstream
 */
MemStream.prototype.setKeepAlive = function (enable, time) {}

/**
 *  ### memstream.setTimeout()
 *
 *  The method ´setTimeout´ is simple ignore in memstream
 */
MemStream.prototype.setTimeout = function (msecs) {}

/**
 *  ### memstream.setEncoding()
 * 
 *  Makes the data event emit a string instead of a Buffer. encoding can 
 *  be ´utf8´, ´ascii´, or ´base64´.
 */
MemStream.prototype.setEncoding = function (encoding) {
  var StringDecoder = require("string_decoder").StringDecoder; // lazy load
  this._decoder = new StringDecoder(encoding);
};

MemStream.prototype.end = function (data, encoding) {
  if (this.writable) { 
    if (data) this.write(data, encoding);
    if (this._writeQueueLast() !== END_OF_FILE) {
      this._writeQueue.push(END_OF_FILE);
      this.flush();
    }
  }
}

MemStream.prototype.write = function (data, encoding) {
  var self = this;
  var buff = null;

  if (!self.writable) {
    throw new Error("Stream is not writable");
  }
  
  if (typeof data != "string") {
    buff = data;
  } else {
    buff = new Buffer(data, encoding);
  }
  
  if (self._writeQueue && self._writeQueue.length) {
    self._writeQueue.push(buff);
  } else {
    process.nextTick(function() {
      writeTo(self._remoteStream, buff);
    });
  }

  return true;
}

/**
 *  ### memstream.destroy()
 *
 *  Closes the mem stream. Stream will not emit any 
 *  more events.
 */
MemStream.prototype.destroy = function (exception) {
  var self = this;
  
  proxyUnlink(this._address, this._remoteStream);

  this._address = null;
  this._remoteStream = null;
  
  this.readable = false;
  this.writable = false;
  
  process.nextTick(function () {
    if (exception) self.emit('error', exception);
    self.emit('close', exception ? true : false);
  });
}

MemStream.prototype._ondata = function (data) {
  var self = this;
  var string = null;
  var next = null;
  
  if (self._decoder) {
    string = self._decoder.write(data);
    if (string.length) self.emit('data', string);
  } else {
    if (self._events && self._events['data']) {
      self.emit('data', data);
    }
  }
  
  if (self._recvQueue) {
    next = self._recvQueue.pop();
    
    process.nextTick(function() {
      self._ondata(next);
    });
    
    if (!self._recvQueue.length) {
      self._recvQueue = null;
    }
  }
}


function MemServer() {
  this._address = null;
}

exports.MemServer = MemServer;
inherits(MemServer, EventEmitter);

/**
 *  ### memserver.listen(address, [callback])
 *
 *  Begin accepting connections on the specified address.
 * 
 *  This function is asynchronous. The last parameter `callback` will be called
 *  when the server has been bound to the ´address´.
 */
MemServer.prototype.listen = function (address, callback) {
  var self = this;

  if (self._address) throw new Error('Server already opened');

  var lastArg = arguments[arguments.length - 1];

  if (typeof lastArg == 'function') {
    self.addListener('listening', lastArg);
  }
   
  self._address = address;
   
  if (proxyExists(address)) {
    process.nextTick(function() {
      self.emit("error", "Address is already bound.");
    });
  } else {
    proxyBind(address, function(err, stream) {
      if (err) {
        err && self.emit("error", err);
      } else {
        self.emit("connection", stream);
      }
    });
     
    self.emit("listening");
  }   
}

MemServer.prototype.address = function () {
  return this._address;
};

MemServer.prototype.close = function() {
  var self = this;
  
  if (!self._address) {
    throw new Error("Not running");
  }
  
  proxyUnbind(self._address);
  
  self.emit("close");
}

function writeTo(stream, data) {
  if (stream._recvQueue) {
    stream._recvQueue.push(data);
  } else {
    stream._ondata(data);
  }  
}


function proxyExists (address) {
  return proxy[address] !== undefined;
}

function proxyBind (address, callback) {
  proxy[address] = {
    connectionCallback: callback,
    links: []
  };
}

function proxyUnbind (address) {
  var links = proxy[address].links;
  var index = links.length;

  proxy[address] = undefined;
  
  while (index--) {
    links[index].emit("close", false);
  }
}

function proxyLink (address, stream, callback) {
  var client = new MemStream(stream);
  proxy[address].links.push(client);
  process.nextTick(function() {
    proxy[address].connectionCallback(null, client);
    callback && callback(client);
  });
}

function proxyUnlink (address, stream) {
  var links = proxy[address] && proxy[address].links;
  var index = links ? links.indexOf(stream) : -1;
  
  if (index !== -1) {
    links.splice(index);
    stream.destroy();
  }
  
  
} 
 