import type { SelectedAttachment } from "./contracts";

export interface UploadedAttachment { id: string; name: string; size: number; }

function uploadOne(file: SelectedAttachment, baseUrl: string, token: string): Promise<UploadedAttachment> {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${baseUrl.replace(/\/$/, "")}/api/wechat/uploads`,
      filePath: file.path,
      name: "file",
      formData: { name: file.name, size: String(file.size) },
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject({ message: "附件上传失败" });
        try { resolve(JSON.parse(response.data)); } catch { reject({ message: "附件上传返回格式错误" }); }
      },
      fail: reject
    });
  });
}

export async function uploadAttachments(files: SelectedAttachment[], baseUrl: string, token: string) {
  return Promise.all(files.map((file) => uploadOne(file, baseUrl, token)));
}
