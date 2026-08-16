export default class TrackTransitionQueue {
  constructor(worker) {
    if (typeof worker !== 'function') {
      throw new TypeError('TrackTransitionQueue requires a worker function');
    }
    this.worker = worker;
    this.tail = Promise.resolve();
    this.accepting = true;
  }

  enqueue(request) {
    if (!this.accepting) {
      return Promise.reject(new Error('Track transition queue is paused'));
    }

    const operation = this.tail.then(() => this.worker(request));
    this.tail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  drain() {
    return this.tail;
  }

  pause() {
    this.accepting = false;
  }

  resume() {
    this.accepting = true;
  }
}
