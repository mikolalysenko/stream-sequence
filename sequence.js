var Stream = require("stream");

var TASK_TYPE = {
  CHUNK:  0,
  STREAM: 1,
  EOF:    2,
  ERROR:  3
};

function Task(type, data) {
  this.type = type;
  this.data = data;
}

function Sequence() {
  var stream = new Stream();
  stream.writable = true;
  stream.readable = true;
  
  
  this.stream   = stream;
  this._queue   = [];
  this._writing   = false;  //When this flag is set, another _next event is scheduled
  this._closed    = false;  //If set, stream is dead.  Don't accept new events
  
  this._next  = Sequence.prototype._nextWrite.bind(this);
  this._error = Sequence.prototype.error.bind(this);
}

Sequence.prototype._nextWrite = function() {
  if(queue.length === 0) {
    this._writing = false;
    return;
  }
  this._writing   = true;
  
  //Pop off the head of the queue and do it
  var task = this._queue[0];
  this._queue.shift();
  
  switch(task.type) {
    case TASK_TYPE.CHUNK:
      if(this.stream.write(task.data)) {
        while(this._queue.length > 0 &&
              this._queue[0].type === TASK_TYPE.CHUNK) {
          var data = this._queue[0].data;
          this._queue.shift();
          if(!this.stream.write(data)) {
            this.stream.once("drain", this._next);
            return;
          }
        }
        if(this._queue.length > 0) {
          process.nextTick(this._next);
        } else {
          this._writing = false;
        }
      } else {
        this.stream.once("drain", this._next);
      }
    break;
    
    case TASK_TYPE.STREAM:
      task.data.resume();
      task.data.on("end", this._next)
      task.data.on("error", this._error);
      task.data.pipe(this.stream, { end: false });
    break;
    
    case TASK_TYPE.EOF:
      this.stream.end();
      this._close();
    break;
  }
}

Sequence.prototype._addTask = function(task) {
  this._queue.push(task);
  if(!this._writing) {
    this._writing = true;
    process.nextTick(this._next);
  }
}

Sequence.prototype._close = function() {
  for(var i=0; i<this._queue.length; ++i) {
    if(this._queue[i].type === TASK_TYPE.STREAM) {
      this._queue[i].data.destroy();
    }
  }
  this._queue.length = 0;
}

Sequence.prototype.write = function(buffer) {
  if(this._closed) {
    return false;
  }
  if(!this.writing) {
    if(!this.stream.write(buffer)) {
      this._writing = true;
      this.stream.once("drain", this._next);
      return false;
    }
    return true;
  } else {
    this._addTask(new Task(TASK_TYPE.CHUNK, buffer));
    return false;
  }
}

Sequence.prototype.insert = function(stream) {
  if(this._closed) {
    return null;
  }
  if(!this._writing) {
    this._writing = true;
    stream.resume();
    stream.on("end", this._next);
    stream.on("error", this._error);
    stream.pipe(this.stream, { end: false });
  } else {
    stream.pause();
    this._addTask(new Task(TASK_TYPE.STREAM, stream));
  }
  return this;
}

Sequence.prototype.end = function() {
  if(this._closed) {
    return;
  }
  this._closed = true;
  this._addTask(new Task(TASK_TYPE.EOF));
}

Sequence.prototype.error = function(err) {
  if(this._closed) {
    return;
  }
  this._closed = true;
  this.stream.emit("error", err);
  this._close();
}

module.exports = Sequence;
