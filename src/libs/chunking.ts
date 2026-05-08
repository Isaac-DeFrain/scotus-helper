/**
 * Chunking library for the SCOTUS Opinion Helper.
 * Defines the Chunk type and the chunkText function, which splits text into overlapping sentence-based chunks for embedding.
 */

export type Chunk = {
  id: string;
  content: string;
  metadata: {
    source: string;
    chunkIndex: number;
    totalChunks: number;
    startChar: number;
    endChar: number;
    [key: string]: string | number | boolean | string[];
  };
};

/**
 * Splits text into overlapping sentence-based chunks for embedding.
 */
export function chunkText(
  text: string,
  chunkSize: number = 500,
  overlap: number = 50,
  source: string = "unknown",
): Chunk[] {
  const chunks: Chunk[] = [];
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);

  let currentChunk = "";
  let chunkStart = 0;
  let chunkIndex = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i].trim() + ".";

    if (
      currentChunk.length + sentence.length > chunkSize &&
      currentChunk.length > 0
    ) {
      const chunk: Chunk = {
        id: `${source}-chunk-${chunkIndex}`,
        content: currentChunk.trim(),
        metadata: {
          source,
          chunkIndex,
          totalChunks: 0,
          startChar: chunkStart,
          endChar: chunkStart + currentChunk.length,
        },
      };

      chunks.push(chunk);

      const overlapText = getLastWords(currentChunk, overlap);
      currentChunk = overlapText + " " + sentence;
      chunkStart = chunk.metadata.endChar - overlapText.length;
      chunkIndex++;
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence;
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      id: `${source}-chunk-${chunkIndex}`,
      content: currentChunk.trim(),
      metadata: {
        source,
        chunkIndex,
        totalChunks: 0,
        startChar: chunkStart,
        endChar: chunkStart + currentChunk.length,
      },
    });
  }

  chunks.forEach((chunk) => {
    chunk.metadata.totalChunks = chunks.length;
  });

  return chunks;
}

/**
 * Returns the last N characters worth of complete words from a string.
 * Used to create overlap between chunks without cutting mid-word.
 */
function getLastWords(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const words = text.split(" ");
  let result = "";

  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i];
    const potential = word + (result ? " " + result : "");
    if (potential.length > maxLength) break;
    result = potential;
  }

  return result;
}
