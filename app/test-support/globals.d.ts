// Node 22 provides these at runtime under jest; the RN tsconfig does not include the DOM lib.
declare class TextEncoder {
  encode(input: string): Uint8Array;
}
declare class TextDecoder {
  decode(input: ArrayBuffer | ArrayBufferView): string;
}
