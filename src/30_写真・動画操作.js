/**
 * Googleフォト管理ライブラリ：写真・動画の操作
 */

/**
 * 【公開API】ドライブ上のファイルをGoogleフォトへアップロードする
 * 使う場面：スクリーンショットのバックアップなど、ドライブの画像をGoogleフォトへ送る時
 * ※ 元ファイルの削除は行わない。成功後に削除するかどうかは、ホスト側で判断する
 *
 * @param {GoogleAppsScript.Drive.File} driveFile アップロード対象のファイル
 * @param {string} [albumId] 追加先のアルバムID（省略時はライブラリ直下）
 * @returns {{id: string, fileName: string, productUrl: string}} 登録されたメディアアイテムの情報
 * @throws {Error} アップロードまたは登録に失敗した場合
 */
function uploadFile(driveFile, albumId) {
  const fileName = driveFile.getName();

  // 1. 画像のバイナリデータをアップロードしてトークンを取得する
  const uploadToken = uploadImageBytes_(driveFile.getBlob().getBytes(), fileName);

  // 2. トークンを使用してフォトのライブラリ（およびアルバム）に登録する
  return registerMediaItem_(uploadToken, fileName, albumId);
}

/**
 * 【公開API】アルバム内の写真・動画の一覧を取得する
 * 使う場面：uploadFile() でアップロードした写真を確認したい時、または表示に使う時
 * ※ 取得できるのは、uploadFile() でアップロードした写真・動画のみ（手動で追加した写真は取得できない）
 * ※ 戻り値の baseUrl の有効期限は約60分のため、保存せず、表示のたびに取得し直すこと
 *
 * @param {string} albumId 取得対象のアルバムID
 * @param {number} [maxItems] 取得する件数の上限（省略時は全件）
 * @returns {Array<{id: string, fileName: string, mimeType: string, baseUrl: string, productUrl: string, creationTime: string}>} メディアアイテムの配列
 * @throws {Error} API呼び出しに失敗した場合
 */
function listMediaItems(albumId, maxItems) {
  const mediaItems = [];
  let nextPageToken = "";

  // 次のページがなくなる、または上限件数に達するまで繰り返し取得（1ページの最大件数は100）
  do {
    const responseBody = callPhotosApi_("post", "mediaItems:search", {
      albumId: albumId,
      pageSize: 100,
      pageToken: nextPageToken,
    });
    (responseBody.mediaItems || []).forEach((mediaItem) => {
      mediaItems.push({
        id: mediaItem.id,
        fileName: mediaItem.filename || "",
        mimeType: mediaItem.mimeType || "",
        baseUrl: mediaItem.baseUrl,
        productUrl: mediaItem.productUrl || "",
        creationTime: mediaItem.mediaMetadata ? mediaItem.mediaMetadata.creationTime : "",
      });
    });
    nextPageToken = responseBody.nextPageToken || "";
  } while (nextPageToken && !(maxItems && mediaItems.length >= maxItems));

  return maxItems ? mediaItems.slice(0, maxItems) : mediaItems;
}

/**
 * 【公開API】baseUrl にサイズ指定を付与した、表示用の画像URLを組み立てる
 * 使う場面：listMediaItems() で取得した写真を、指定サイズで表示したい時
 *
 * @param {string} baseUrl メディアアイテムの baseUrl
 * @param {number} width 最大の幅（px）
 * @param {number} height 最大の高さ（px）
 * @returns {string} サイズ指定付きの画像URL
 */
function buildImageUrl(baseUrl, width, height) {
  return `${baseUrl}=w${width}-h${height}`;
}

/**
 * 画像バイナリをアップロードしてアップロードトークンを取得する（内部用）
 *
 * @param {number[]} imageBytes 画像のバイト配列
 * @param {string} fileName ファイル名
 * @returns {string} アップロードトークン
 * @throws {Error} アップロードに失敗した場合
 */
function uploadImageBytes_(imageBytes, fileName) {
  // Google フォト API にバイナリデータを送信するためのリクエスト設定
  // ※ JSONではなくバイナリを送るため、callPhotosApi_ は使わず直接送信する
  const requestOptions = {
    method: "post",
    headers: {
      Authorization: `Bearer ${getPhotosAccessToken_()}`,
      "Content-type": "application/octet-stream",
      "X-Goog-Upload-Protocol": "raw",
      "X-Goog-Upload-File-Name": fileName,
    },
    payload: imageBytes,
    muteHttpExceptions: true,
  };

  // アップロードを実行し、結果のトークンを返す
  const response = UrlFetchApp.fetch("https://photoslibrary.googleapis.com/v1/uploads", requestOptions);
  if (response.getResponseCode() !== 200) {
    throw new Error(`アップロードに失敗しました。ファイル名：${fileName}、HTTP ${response.getResponseCode()}：${response.getContentText()}`);
  }
  return response.getContentText();
}

/**
 * アップロードトークンをライブラリ（およびアルバム）に登録する（内部用）
 *
 * @param {string} uploadToken アップロードトークン
 * @param {string} fileName ファイル名
 * @param {string} [albumId] 追加先のアルバムID（省略時はライブラリ直下）
 * @returns {{id: string, fileName: string, productUrl: string}} 登録されたメディアアイテムの情報
 * @throws {Error} 登録に失敗した場合
 */
function registerMediaItem_(uploadToken, fileName, albumId) {
  const requestPayload = {
    newMediaItems: [
      {
        simpleMediaItem: {
          uploadToken: uploadToken,
          fileName: fileName,
        },
      },
    ],
  };

  // アルバムIDが指定されている場合、アルバム先頭に画像を追加
  if (albumId) {
    requestPayload.albumId = albumId;
    requestPayload.albumPosition = {
      position: "FIRST_IN_ALBUM",
    };
  }

  const responseBody = callPhotosApi_("post", "mediaItems:batchCreate", requestPayload);

  // 全体がHTTP 200でも、アイテム単位で失敗している場合があるため、結果の状態を個別に確認
  // ※ 既にアップロード済の場合もGoogle側の仕様で成功扱いとなる
  const registerResult = (responseBody.newMediaItemResults || [])[0];
  const resultStatus = registerResult && registerResult.status;
  if (!registerResult || (resultStatus && resultStatus.code)) {
    const failureMessage = resultStatus && resultStatus.message ? resultStatus.message : "結果を取得できませんでした";
    throw new Error(`ライブラリへの登録に失敗しました。ファイル名：${fileName}、理由：${failureMessage}`);
  }

  const mediaItem = registerResult.mediaItem || {};
  return {
    id: mediaItem.id || "",
    fileName: mediaItem.filename || fileName,
    productUrl: mediaItem.productUrl || "",
  };
}
