export interface ReplyNoteWriteRequest {
  mode: 'create' | 'append';
  path: string;
  content: string;
}

export interface ReplyNoteWriteReceipt {
  readonly path: string;
  /** Removes only this write; a newly created note is kept. */
  undo(): Promise<void>;
}

export interface ReplyNoteWriter {
  save(request: ReplyNoteWriteRequest): Promise<ReplyNoteWriteReceipt>;
}

export class ReplyNoteWriteError extends Error {
  constructor(readonly code: 'invalidPath' | 'emptyContent' | 'missingNote' | 'exists' | 'conflict') {
    super(code);
    this.name = 'ReplyNoteWriteError';
  }
}
