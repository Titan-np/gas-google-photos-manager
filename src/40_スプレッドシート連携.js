/**
 * Googleフォト管理：スプレッドシート連携（メニュー操作）
 *
 * ■ このファイルの役割
 *   管理用スプレッドシートから、認可・アルバム作成・アルバム一覧の同期を行うメニューを提供する。
 *   スプレッドシートを参照するのは、このファイルのみ。
 *
 * ■ ホスト側（このライブラリを呼ぶアプリ）からは使わない
 *   このファイルの関数（onOpen と menu で始まる関数）は、スプレッドシートのメニュー専用。
 *   ホスト側は、シートに表示されたアルバムIDを控えて、20_アルバム操作.js / 30_写真・動画操作.js の公開APIへ渡す。
 */

// メニューの表示名
const MENU_TITLE = "Googleフォト管理";

// アルバム管理シートの名称
const ALBUM_SHEET_NAME = "アルバム";

// アルバム管理シートの列見出し（左から順に並べる。「状態」は最後の列）
const ALBUM_SHEET_HEADERS = ["タイトル", "アルバムID", "枚数", "Web URL", "状態"];

// アルバムIDの列番号（1始まり。数値や日付への自動変換を防ぐ書式設定に使用）
const ALBUM_ID_COLUMN_NUMBER = 2;

// 状態列に表示する値（未作成の行は空欄）
const ALBUM_STATUS_ACTIVE = "有効";
const ALBUM_STATUS_NOT_FOUND = "未検出";

/**
 * スプレッドシートを開いた時にカスタムメニューを追加する
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(MENU_TITLE)
    .addItem("シートを初期化", "menuInitializeSheet")
    .addSeparator()
    .addItem("認可の手順を表示", "menuShowAuthorizationGuide")
    .addItem("認可をリセット", "menuResetAuthorization")
    .addSeparator()
    .addItem("選択行のアルバムを作成", "menuCreateSelectedAlbums")
    .addItem("アルバム一覧を同期", "menuSyncAlbums")
    .addToUi();
}

/**
 * メニュー：アルバム管理シートを初期化する
 */
function menuInitializeSheet() {
  runMenuAction_(() => {
    getAlbumSheet_();
    showMessage_(`シート「${ALBUM_SHEET_NAME}」を準備しました。`);
  });
}

/**
 * メニュー：認可の状態と、リダイレクトURIの登録 → 認可ページを開く、の手順をまとめて表示する
 */
function menuShowAuthorizationGuide() {
  runMenuAction_(() => {
    // 認可済みでもリダイレクトURIを確認できるよう、状態に関わらず手順を表示
    const statusText = isAuthorized() ? "認可済み（再認可する場合は、先に「認可をリセット」を実行してください）" : "未認可";

    // リダイレクトURIは全選択してコピーしやすいよう読み取り専用の入力欄で、
    // 認可URLはダイアログ内の文字列がクリックできないためリンクで表示
    const dialogHtml = HtmlService.createHtmlOutput(
      `<p>現在の状態：${statusText}</p>` +
        "<p>手順1：GCPコンソールのOAuthクライアント「承認済みのリダイレクトURI」に、下記を登録してください（登録済みなら不要）。</p>" +
        `<input type="text" readonly style="width:100%" value="${escapeHtml_(getRedirectUri())}" onclick="this.select()">` +
        "<p>手順2：下記のリンクを開き、Googleフォトへのアクセスを許可してください。</p>" +
        `<p><a href="${escapeHtml_(getAuthorizationUrl())}" target="_blank">認可ページを開く</a></p>` +
        "<p>手順3：完了後、このダイアログを閉じてください。</p>",
    )
      .setWidth(480)
      .setHeight(320);
    SpreadsheetApp.getUi().showModalDialog(dialogHtml, "Googleフォトの認可");
  });
}

/**
 * メニュー：認可情報をリセットする（確認ダイアログ付き）
 */
function menuResetAuthorization() {
  runMenuAction_(() => {
    const ui = SpreadsheetApp.getUi();
    const confirmation = ui.alert(MENU_TITLE, "認可情報をリセットします。よろしいですか？", ui.ButtonSet.YES_NO);
    if (confirmation !== ui.Button.YES) {
      return;
    }

    resetAuth();
    showMessage_("認可情報をリセットしました。メニューから再度認可してください。");
  });
}

/**
 * メニュー：選択した行のうち、タイトルが入力済みで未作成のアルバムを作成する
 */
function menuCreateSelectedAlbums() {
  runMenuAction_(() => {
    const albumSheet = getAlbumSheet_();
    const selectedRange = SpreadsheetApp.getActiveRange();
    if (selectedRange.getSheet().getName() !== ALBUM_SHEET_NAME) {
      throw new Error(`シート「${ALBUM_SHEET_NAME}」で実行してください。`);
    }

    // 見出し行（1行目）は対象外
    const firstRowNumber = Math.max(selectedRange.getRow(), 2);
    const lastRowNumber = selectedRange.getLastRow();
    if (lastRowNumber < firstRowNumber) {
      throw new Error("データ行を選択してください。");
    }

    let createdCount = 0;
    let skippedCount = 0;
    readAlbumRows_(albumSheet)
      .filter((albumRow) => albumRow.rowNumber >= firstRowNumber && albumRow.rowNumber <= lastRowNumber)
      .forEach((albumRow) => {
        // 作成済み、またはタイトルが未入力の行は作成せずスキップ
        if (albumRow.albumId || !albumRow.title) {
          skippedCount++;
          return;
        }

        const createdAlbum = createAlbum(albumRow.title);
        albumSheet.getRange(albumRow.rowNumber, 1, 1, ALBUM_SHEET_HEADERS.length).setValues([convertAlbumToRowValues_(createdAlbum)]);
        createdCount++;
      });

    showMessage_(`作成：${createdCount}件、スキップ：${skippedCount}件`);
  });
}

/**
 * メニュー：Googleフォト上のアルバム一覧を、管理シートへ同期する
 * ・シートにあるアルバム：最新の情報で更新（Googleフォト上で見つからない場合は「未検出」）
 * ・シートにないアルバム：末尾に追加
 * ・未作成の行：変更しない
 */
function menuSyncAlbums() {
  runMenuAction_(() => {
    const apiAlbums = listAlbums();
    const apiAlbumMap = new Map(apiAlbums.map((apiAlbum) => [apiAlbum.id, apiAlbum]));

    const albumSheet = getAlbumSheet_();
    const sheetRows = readAlbumRows_(albumSheet);
    let updatedCount = 0;
    let notFoundCount = 0;

    // 1. シートにあるアルバムを更新
    sheetRows.forEach((albumRow) => {
      if (!albumRow.albumId) {
        return;
      }

      const apiAlbum = apiAlbumMap.get(albumRow.albumId);
      if (apiAlbum) {
        albumSheet.getRange(albumRow.rowNumber, 1, 1, ALBUM_SHEET_HEADERS.length).setValues([convertAlbumToRowValues_(apiAlbum)]);
        updatedCount++;
      } else {
        // 状態列（最後の列）のみ書き換え、他の列は直前の同期結果を残す
        albumSheet.getRange(albumRow.rowNumber, ALBUM_SHEET_HEADERS.length).setValue(ALBUM_STATUS_NOT_FOUND);
        notFoundCount++;
      }
    });

    // 2. シートにないアルバムを末尾へ追加
    const knownAlbumIds = new Set(sheetRows.map((albumRow) => albumRow.albumId));
    const addedRowValuesList = apiAlbums.filter((apiAlbum) => !knownAlbumIds.has(apiAlbum.id)).map(convertAlbumToRowValues_);
    if (addedRowValuesList.length > 0) {
      albumSheet.getRange(albumSheet.getLastRow() + 1, 1, addedRowValuesList.length, ALBUM_SHEET_HEADERS.length).setValues(addedRowValuesList);
    }

    showMessage_(`同期しました。\n更新：${updatedCount}件、追加：${addedRowValuesList.length}件、未検出：${notFoundCount}件`);
  });
}

/**
 * アルバム管理シートを取得する（内部用）
 * シートが存在しない場合は新規作成し、空のシートには見出し行を作成する
 *
 * @returns {GoogleAppsScript.Spreadsheet.Sheet} アルバム管理シート
 */
function getAlbumSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const albumSheet = spreadsheet.getSheetByName(ALBUM_SHEET_NAME) || spreadsheet.insertSheet(ALBUM_SHEET_NAME);

  // 空のシートの場合のみ見出し行を作成
  if (albumSheet.getLastRow() === 0) {
    albumSheet.getRange(1, 1, 1, ALBUM_SHEET_HEADERS.length).setValues([ALBUM_SHEET_HEADERS]).setFontWeight("bold");
    albumSheet.setFrozenRows(1);
  }

  // アルバムIDが数値や日付に自動変換されないよう、書式をプレーンテキストに固定
  albumSheet.getRange(1, ALBUM_ID_COLUMN_NUMBER, albumSheet.getMaxRows(), 1).setNumberFormat("@");
  return albumSheet;
}

/**
 * アルバム管理シートの全データ行から、タイトルとアルバムIDを読み込む（内部用）
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} albumSheet アルバム管理シート
 * @returns {Array<{rowNumber: number, title: string, albumId: string}>} 行番号付きの配列
 */
function readAlbumRows_(albumSheet) {
  const lastRowNumber = albumSheet.getLastRow();
  if (lastRowNumber < 2) {
    return [];
  }

  const rowValuesList = albumSheet.getRange(2, 1, lastRowNumber - 1, ALBUM_SHEET_HEADERS.length).getValues();

  // 列の並びは ALBUM_SHEET_HEADERS のとおり（0番目がタイトル、1番目がアルバムID）
  return rowValuesList.map((rowValues, rowOffset) => ({
    rowNumber: rowOffset + 2,
    title: String(rowValues[0]).trim(),
    albumId: String(rowValues[1]).trim(),
  }));
}

/**
 * アルバム情報を、シートの列順に並べた配列へ変換する（内部用）
 *
 * @param {{id: string, title: string, mediaItemsCount: number, productUrl: string}} album アルバム情報
 * @returns {Array} シートへ書き込むための1行分の値
 */
function convertAlbumToRowValues_(album) {
  return [album.title, album.id, album.mediaItemsCount, album.productUrl, ALBUM_STATUS_ACTIVE];
}

/**
 * メニューから呼ばれる処理を実行し、エラー時はダイアログで通知する（内部用）
 *
 * @param {function(): void} menuAction 実行する処理
 */
function runMenuAction_(menuAction) {
  try {
    menuAction();
  } catch (menuError) {
    showMessage_(`エラーが発生しました。\n${menuError.message}`);
  }
}

/**
 * メッセージのダイアログを表示する（内部用）
 *
 * @param {string} dialogMessage 表示するメッセージ
 */
function showMessage_(dialogMessage) {
  SpreadsheetApp.getUi().alert(MENU_TITLE, dialogMessage, SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * HTMLの特殊文字をエスケープする（内部用）
 *
 * @param {string} rawText エスケープ前の文字列
 * @returns {string} エスケープ後の文字列
 */
function escapeHtml_(rawText) {
  return String(rawText).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
