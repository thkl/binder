declare module 'mailparser' {
  interface ParsedAttachment {
    contentType: string;
    filename?: string;
    size: number;
    content: Buffer;
  }

  interface ParsedMail {
    attachments: ParsedAttachment[];
  }

  export function simpleParser(
    source: Buffer,
    options?: { skipHtmlToText?: boolean; skipTextToHtml?: boolean },
  ): Promise<ParsedMail>;
}
