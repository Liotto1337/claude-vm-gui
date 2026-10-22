/** Вложение в поле ввода: картинка, загружаемая на ВМ. */
export interface Attachment {
  id: string;
  name: string;
  url: string;
  bytes: Uint8Array;
  ext: 'png' | 'jpg' | 'gif' | 'webp';
  status: 'uploading' | 'done' | 'error';
  percent: number;
  size: number;
  remotePath?: string;
  error?: string;
}

export const revoke = (a: Attachment): void => URL.revokeObjectURL(a.url);
