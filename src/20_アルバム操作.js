/**
 * Googleフォト管理ライブラリ：アルバム操作
 */

/**
 * 【公開API】アルバムを新規作成する
 * 使う場面：アルバムを初めて用意する時。ホスト側で毎回呼ぶ必要はなく、
 * 作成したアルバムのIDを控えて、以降は uploadFile() などへ渡して使う
 *
 * @param {string} albumTitle 作成するアルバムのタイトル
 * @returns {{id: string, title: string, mediaItemsCount: number, productUrl: string}} 作成したアルバムの情報
 * @throws {Error} タイトルが空の場合、またはAPI呼び出しに失敗した場合
 */
function createAlbum(albumTitle) {
  if (!albumTitle) {
    throw new Error("アルバムのタイトルを指定してください。");
  }

  const createdAlbum = callPhotosApi_("post", "albums", { album: { title: albumTitle } });
  console.log(`アルバムを新規作成しました：「${createdAlbum.title}」（ID：${createdAlbum.id}）`);

  return {
    id: createdAlbum.id,
    title: createdAlbum.title,
    // 作成直後は空のアルバムのため、枚数は0固定
    mediaItemsCount: 0,
    productUrl: createdAlbum.productUrl || "",
  };
}

/**
 * 【公開API】アルバムの一覧を取得する
 * 使う場面：作成済みのアルバムとそのIDを確認したい時。ホスト側で日常的に呼ぶ必要はない
 *
 * @returns {Array<{id: string, title: string, mediaItemsCount: number, productUrl: string}>} アルバム情報の配列
 * @throws {Error} API呼び出しに失敗した場合
 */
function listAlbums() {
  const albums = [];
  let nextPageToken = "";

  // 次のページがなくなるまで繰り返し取得
  do {
    const responseBody = callPhotosApi_("get", "albums", { pageSize: 50, pageToken: nextPageToken });
    (responseBody.albums || []).forEach((album) => {
      albums.push({
        id: album.id,
        title: album.title || "",
        // APIは枚数を文字列で返すため、数値へ変換
        mediaItemsCount: Number(album.mediaItemsCount || 0),
        productUrl: album.productUrl || "",
      });
    });
    nextPageToken = responseBody.nextPageToken || "";
  } while (nextPageToken);

  return albums;
}
