/** Вложение в поле ввода: файл, загружаемый на ВМ (image — картинка, у неё есть превью url). */
export interface Attachment {
  id: string;
  name: string;
  url: string;
  bytes: Uint8Array;
  image: boolean;
  status: 'uploading' | 'done' | 'error';
  percent: number;
  size: number;
  remotePath?: string;
  error?: string;
}

export const revoke = (a: Attachment): void => {
  if (a.url) URL.revokeObjectURL(a.url);
};
