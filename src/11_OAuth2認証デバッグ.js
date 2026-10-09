/**
 * Googleフォト管理ライブラリ：認証とAPI呼び出し関連デバッグ
 */

/**
 * 【公開API】デバッグ用：認可の手順と、リダイレクトURI・認可URLをまとめてログ出力する
 * 使う場面：GASエディタ（ライブラリ側）から、初回認可する時、または認可が切れた時
 */
function logAuthorizationGuide() {
  // 認可済みでもリダイレクトURIを確認できるよう、状態に関わらず両方を出力
  const statusText = isAuthorized() ? "認可済み（再認可する場合は、先に resetAuth() を実行してください）" : "未認可";
  console.log(`現在の状態：${statusText}`);
  console.log(`手順1：GCPコンソールのOAuthクライアント「承認済みのリダイレクトURI」に、下記を登録する（登録済みなら不要）\n${getRedirectUri()}`);
  console.log(`手順2：下記の認可URLをブラウザで開き、Googleフォトへのアクセスを許可する\n${getAuthorizationUrl()}`);
}

/**
 * 【公開API】デバッグ用：実行中のスクリプトIDと、参照できるスクリプトプロパティのキー名をログ出力する
 * 使う場面：設定が読めないなどのトラブル時の切り分け用
 * （ホスト側から MyGooglePhotos.logRuntimeContext() を実行した結果、ライブラリ側のプロパティを参照することを確認済み。）
 */
function logRuntimeContext() {
  const propertyKeys = Object.keys(PropertiesService.getScriptProperties().getProperties());

  // 値はシークレットを含むため、キー名のみ出力
  console.log(`実行中のスクリプトID：${ScriptApp.getScriptId()}`);
  console.log(`参照できるスクリプトプロパティ（キー名のみ）：${propertyKeys.length > 0 ? propertyKeys.join("、") : "なし"}`);
}
