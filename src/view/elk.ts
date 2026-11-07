import ElkConstructor, { type ELK } from "elkjs/lib/elk-api";
import workerUrl from "elkjs/lib/elk-worker.min.js?url";

let instance: ELK | undefined;

/** A shared ELK instance that runs layouts in a web worker. */
export function getElk(): ELK {
  instance ??= new ElkConstructor({ workerUrl });
  return instance;
}
