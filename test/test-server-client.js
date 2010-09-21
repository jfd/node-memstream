const ok              = require("assert").ok
    , equal           = require("assert").equal
    , MemStream       = require("../lib/memstream").MemStream
    , MemServer       = require("../lib/memstream").MemServer
    
const ADDRESS         = "test",
      SERVER_MESSAGE  = "pong",
      CLIENT_MESSAGE  = "ping"

var timeout = null
  , server = null
  , client = null
  , connectTriggered = false
  , closeTriggered = false

var server = new MemServer();
server.on("connection", function(stream) {
  stream.setEncoding("utf8");
  stream.on("data", function(data) {
    equal(data, CLIENT_MESSAGE);
    this.write(SERVER_MESSAGE);
  });
  stream.on("close", function() {
    closeTriggered = true;
  })
});
server.listen(ADDRESS);
    
client = new MemStream();
client.connect(ADDRESS);
client.on("connect", function() {
  connectTriggered = true;
  this.write(CLIENT_MESSAGE);
});
client.on("data", function(data) {
  equal(data, SERVER_MESSAGE);
  this.destroy();
});
client.on("close", function(hadError) {
  ok(!hadError);
  ok(connectTriggered);
  ok(closeTriggered);
  clearTimeout(timeout);  
})

timeout = setTimeout(function() {
  throw new Error("Test timeout");
}, 1000);