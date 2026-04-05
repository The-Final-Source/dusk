export type Annotation = {
  constraintId: string;
};

export type AnnotationWithLine = Annotation & {
  line: number;
};

/**
 * Parse a single line for a @dusk annotation.
 * Matches: // @dusk <constraint-id>
 * Returns the parsed annotation or null if no match.
 */
export const parseAnnotation = (line: string): Annotation | null => {
  const match = line.match(/\/\/\s*@dusk\s+([\w-]+)/);
  if (!match) return null;
  return { constraintId: match[1] };
};

/**
 * Extract all @dusk annotations from a source string.
 * Returns annotations with 1-based line numbers.
 */
export const extractAnnotations = (source: string): AnnotationWithLine[] => {
  const lines = source.split("\n");
  const annotations: AnnotationWithLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const result = parseAnnotation(lines[i]);
    if (result) {
      annotations.push({ ...result, line: i + 1 });
    }
  }
  return annotations;
};
