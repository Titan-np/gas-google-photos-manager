/**
 * Googleフォト管理ライブラリ：認証とAPI呼び出し
 */

/**
 * GoogleフォトのOAuth2認証サービスを構築して返却する（内部用）
 *
 * @returns {OAuth2.Service} OAuth2サービスオブジェクト
 * @throws {Error} クライアントIDまたはシークレットが未設定の場合
 */
function getPhotosOAuth2Service_() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const clientId = scriptProperties.getProperty("GOOGLE_PHOTOS_CLIENT_ID") || "";
  const clientSecret = scriptProperties.getProperty("GOOGLE_PHOTOS_CLIENT_SECRET") || "";

  // ホスト側から呼ばれた場合も、参照するのはライブラリ側のスクリプトプロパティ（ホスト側への設定は不要）
  // スクリプトプロパティにクライアントIDまたはシークレットが設定されていない場合は中断
  if (!clientId || !clientSecret) {
    throw new Error("スクリプトプロパティ「GOOGLE_PHOTOS_CLIENT_ID」または「GOOGLE_PHOTOS_CLIENT_SECRET」が設定されていません。");
  }

  // OAuth2認証サービスを構築（Google Photos Library APIの制限付きスコープに対応）
  return OAuth2.createService("GooglePhotos")
    .setAuthorizationBaseUrl("https://accounts.google.com/o/oauth2/auth")
    .setTokenUrl("https://accounts.google.com/o/oauth2/token")
    .setClientId(clientId)
    .setClientSecret(clientSecret)
    .setCallbackFunction("authCallback_")
    .setPropertyStore(PropertiesService.getUserProperties())
    .setScope("https://www.googleapis.com/auth/photoslibrary.appendonly https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata")
    .setParam("access_type", "offline")
    .setParam("prompt", "consent");
}

/**
 * Googleフォトの有効なアクセストークンを取得する（内部用）
 *
 * @returns {string} 有効なアクセストークン
 * @throws {Error} 未認可、または認可の期限切れの場合
 */
function getPhotosAccessToken_() {
  const photosService = getPhotosOAuth2Service_();

  // 認証情報が存在しない、または期限切れの場合は認可を促して中断
  if (!photosService.hasAccess()) {
    throw new Error(
      "Googleフォトの認可が必要です。スプレッドシートのメニュー、または getAuthorizationUrl() で取得したURLから認可を完了してください。",
    );
  }

  return photosService.getAccessToken();
}

/**
 * Google Photos APIを呼び出し、レスポンスをオブジェクトで返す（内部用）
 * 空文字・undefined・nullの項目は送信しない（先頭ページのpageTokenなどを、そのまま渡せるようにするため）
 *
 * @param {string} httpMethod "get" または "post"
 * @param {string} apiEndpoint APIのエンドポイント名（例："albums"、"mediaItems:search"）
 * @param {Object} [params] getの場合はクエリパラメータ、postの場合はJSON本文
 * @returns {Object} レスポンスのJSONをパースしたオブジェクト
 * @throws {Error} HTTPステータスが200以外の場合
 */
function callPhotosApi_(httpMethod, apiEndpoint, params) {
  // 送信する項目だけを残す
  const sendingParams = {};
  Object.keys(params || {}).forEach((paramName) => {
    const paramValue = params[paramName];
    if (paramValue !== "" && paramValue !== undefined && paramValue !== null) {
      sendingParams[paramName] = paramValue;
    }
  });

  let requestUrl = `https://photoslibrary.googleapis.com/v1/${apiEndpoint}`;
  const requestOptions = {
    method: httpMethod,
    headers: {
      Authorization: `Bearer ${getPhotosAccessToken_()}`,
    },
    muteHttpExceptions: true,
  };

  if (httpMethod === "get") {
    // getはクエリ文字列としてURLへ付与
    const queryString = Object.keys(sendingParams)
      .map((paramName) => `${paramName}=${encodeURIComponent(sendingParams[paramName])}`)
      .join("&");
    if (queryString) {
      requestUrl += `?${queryString}`;
    }
  } else {
    // postはJSON本文として送信
    requestOptions.contentType = "application/json";
    requestOptions.payload = JSON.stringify(sendingParams);
  }

  const response = UrlFetchApp.fetch(requestUrl, requestOptions);
  const responseText = response.getContentText();

  if (response.getResponseCode() !== 200) {
    throw new Error(`Googleフォト APIの呼び出しに失敗しました。HTTP ${response.getResponseCode()}：${responseText}`);
  }

  // 空レスポンス（空アルバムの検索結果など）は空オブジェクトとして扱う
  return responseText ? JSON.parse(responseText) : {};
}

/**
 * 【公開API】認可済みかどうかを返す
 * 使う場面：ホスト側で、処理の前に認可状況を確認したい時（通常は不要。未認可なら各APIが例外を投げる）
 *
 * @returns {boolean} 認可済みの場合はtrue
 */
function isAuthorized() {
  return getPhotosOAuth2Service_().hasAccess();
}

/**
 * 【公開API】OAuthクライアントに登録するリダイレクトURIを返す
 * 使う場面：初めて認可する前（GCPコンソールの「承認済みのリダイレクトURI」へ登録する）。通常はスプレッドシートのメニューから実行される
 *
 * @returns {string} リダイレクトURI
 */
function getRedirectUri() {
  return getPhotosOAuth2Service_().getRedirectUri();
}

/**
 * 【公開API】認可ページのURLを返す
 * 使う場面：初回認可する時、または認可が切れた時。通常はスプレッドシートのメニューから実行される
 *
 * @returns {string} ブラウザで開いて連携を許可するためのURL
 */
function getAuthorizationUrl() {
  return getPhotosOAuth2Service_().getAuthorizationUrl();
}

/**
 * 【公開API】OAuth2認証完了時のコールバック処理
 * 使う場面：認可後のリダイレクト先として、本プロジェクトの authCallback_ から呼び出される（ホスト側からは使わない）
 *
 * @param {Object} callbackRequest HTTPリクエストオブジェクト
 * @returns {HtmlOutput} 認可結果を表示するHTMLページ
 */
function handleAuthCallback(callbackRequest) {
  try {
    const isAuthorizedNow = getPhotosOAuth2Service_().handleCallback(callbackRequest);
    if (isAuthorizedNow) {
      return HtmlService.createHtmlOutput("Googleフォトの連携認可に成功しました。このタブを閉じてください。");
    }
    return HtmlService.createHtmlOutput("Googleフォトの連携認可に失敗しました。もう一度お試しください。");
  } catch (authError) {
    return HtmlService.createHtmlOutput(`認可処理でエラーが発生しました：${authError.message}`);
  }
}

/**
 * 本プロジェクト自身のOAuth2コールバック（内部用）
 * 認可はライブラリ側で行うため、ホスト側に同名の関数を用意する必要はない
 *
 * @param {Object} callbackRequest HTTPリクエストオブジェクト
 * @returns {HtmlOutput} 認可結果を表示するHTMLページ
 */
function authCallback_(callbackRequest) {
  return handleAuthCallback(callbackRequest);
}

/**
 * 【公開API】認可情報をリセットする
 * 使う場面：スコープを変更した時、または別アカウントで認可し直したい時
 */
function resetAuth() {
  getPhotosOAuth2Service_().reset();
  console.log("Googleフォトの認可情報をリセットしました。再度認可を行ってください。");
}
