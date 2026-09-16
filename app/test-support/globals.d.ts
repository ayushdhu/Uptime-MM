// Node 22 provides these at runtime under jest; the RN tsconfig does not include the DOM lib.
declare class TextEncoder {
  encode(input: string): Uint8Array;
}
declare class TextDecoder {
  decode(input: ArrayBuffer | ArrayBufferView): string;
}

// Node's Buffer is available under jest; typed loosely so tests can build byte-exact fixtures.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Buffer: any;
