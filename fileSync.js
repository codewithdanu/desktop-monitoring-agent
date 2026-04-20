/**
 * File Sync — Upload local files to server.
 */
const axios    = require('axios');
const FormData = require('form-data');
const fs       = require('fs');
const path     = require('path');
const mime     = require('mime-types');

/**
 * Upload a file from local path to the server.
 * @param {string} filePath
 * @param {object} config
 */
async function uploadFile(filePath, config) {
  if (!filePath) return { error: 'file_path required' };
  if (!fs.existsSync(filePath)) return { error: `File not found: ${filePath}` };

  const form = new FormData();
  const contentType = mime.lookup(filePath) || 'application/octet-stream';
  
  form.append('file', fs.createReadStream(filePath), {
    filename:    path.basename(filePath),
    contentType: contentType,
  });
  form.append('deviceId', config.deviceId);

  try {
    const response = await axios.post(
      `${config.serverUrl}/api/files/upload`,
      form,
      {
        headers: form.getHeaders(),
        timeout: 120000, // 2 minute timeout for large files
        maxContentLength: 500 * 1024 * 1024,
        maxBodyLength: 500 * 1024 * 1024,
      }
    );

    return {
      message:  'File uploaded successfully',
      fileId:   response.data.fileId,
      fileName: response.data.fileName,
    };
  } catch (err) {
    return { error: err.response?.data?.error || err.message };
  }
}

module.exports = { uploadFile };
