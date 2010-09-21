const ok              = require("assert").ok
    , equal           = require("assert").equal
    , MemStream       = require("../lib/memstream").MemStream
    , MemServer       = require("../lib/memstream").MemServer
    
const ADDRESS         = "test",
      MESSAGES        = 1000,
      MESSAGE         = "ping"

var timeout = null
  , server = null
  , client = null

var server = new MemServer();
server.on("connection", function(stream) {
  var count = 0;
  
  stream.setEncoding("utf8");
  stream.pause();
  ok(stream._paused);

  stream.on("data", function(data) {
    ok(!stream._paused);
    equal(data, MESSAGE);
    if (++count==MESSAGES) {
      clearTimeout(timeout);
      process.exit();
    }
  });
  setTimeout(function() {
    stream.resume();
  }, 50);
});
server.listen(ADDRESS);
    
client = new MemStream();
client.connect(ADDRESS);
client.on("connect", function() {
  var count = MESSAGES;
  while (count--) {
    this.write(MESSAGE);
  }
});

timeout = setTimeout(function() {
  throw new Error("Test timeout");
}, 1000);