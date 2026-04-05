export type ParseError = {
  path: string[];
  message: string;
  code: string;
  file?: string;
  line?: number;
};

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; errors: ParseError[] };

export const formatErrors = (errors: ParseError[]): string => {
  return errors
    .map((e) => {
      const location = e.file ? `${e.file}${e.line ? `:${e.line}` : ""}` : "";
      const path = e.path.length > 0 ? e.path.join(".") + ": " : "";
      return `${location ? location + " " : ""}${path}${e.message} (${e.code})`;
    })
    .join("\n");
};
