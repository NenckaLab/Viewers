/**
 * Guards dcmjs AsyncDicomReader.readSequence against reading past EOF.
 *
 * Cornerstone's naturalized wadouri path (naturalizePart10Buffer) does:
 *   reader.stream.addBuffer(arrayBuffer);
 *   reader.stream.setComplete();
 *   await reader.readFile({ listener });
 *
 * ReadBufferStream.isAvailable(n) returns true when the stream is complete,
 * even if fewer than n bytes remain. The top-level read() loop correctly uses
 * isAvailable(1, false), but readSequence() only awaits ensureAvailable() and
 * then calls readTagHeader — which throws:
 *   "Finding view is past end of input for start=N where ... lengths are N"
 *
 * That happens when a sequence hits EOF (missing delimiter, overstated length,
 * or truncated Part 10). Treat that as end-of-sequence instead of failing the
 * whole image load.
 */
import dcmjs from 'dcmjs';

const PAST_END_OF_INPUT = /Finding view is past end of input/;

export function patchAsyncDicomReaderEofGuard(): void {
  const AsyncDicomReader = dcmjs.async?.AsyncDicomReader as
    | {
        prototype: {
          readSequence: (...args: unknown[]) => Promise<unknown> | unknown;
          __xnatEofGuardPatched?: boolean;
        };
      }
    | undefined;

  if (!AsyncDicomReader?.prototype?.readSequence) {
    return;
  }

  const proto = AsyncDicomReader.prototype;
  if (proto.__xnatEofGuardPatched) {
    return;
  }

  const originalReadSequence = proto.readSequence;

  proto.readSequence = async function patchedReadSequence(
    this: unknown,
    ...args: unknown[]
  ) {
    try {
      return await originalReadSequence.apply(this, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (PAST_END_OF_INPUT.test(message)) {
        return;
      }
      throw error;
    }
  };

  proto.__xnatEofGuardPatched = true;
}
