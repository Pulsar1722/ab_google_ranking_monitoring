'use strict';

//各種パラメータ
const CRON_PERIOD_GOOGLE_SEARCH = "30 15 */1 * *"; //cronによるGoogle検索の周期(cronフォーマット) (UTC)
const CONFIG_JSON_FILENAME = "./config.json"; //設定ファイルの(server.jsから見た)相対パス
const GOOGLER_CMD = "googler"; //Google検索を行うスクリプトの呼び出し文字列
const GOOGLER_CALL_INTERVAL_MS = 3000 //Google検索を行うインターバル(単位ms)
const MAX_SEARCH_RESULT_NUM = 25; //設定ファイルの「rank_monitored_searches.search_words」の最大配列長(googleスプレッドシートのスペースの関係上)

const CREDIT_GSHEET_JSON_FILENAME = "./credit-gsheet.json"; //Googleスプレッドシートを開く際に用いる認証情報が書かれたJSONファイルのパス
let confObj = null; //設定ファイルから読みだした値のオブジェクト

//共通パラメータ
const APP_NAME = `google_rank_mon`; //本アプリ名
const APP_VERSION = {
    major: `1`,
    minor: `0`,
    revision: `0`,
}

/**
 * 検索結果格納オブジェクト
 * @param {string} word -検索ワード
 * @param {Number} rank -検索順位
 */
function SearchResult(word, rank) {
    this.word = word; //検索ワード
    this.rank = rank; //検索順位
}

//使用モジュール
const cron = require('node-cron');
const { execSync } = require('child_process')
const { DateTime } = require("luxon"); //時刻を取得。date-utilsより使いやすい
const { GoogleSpreadsheet } = require('google-spreadsheet');

/**
 * スリープ関数(awaitで待ち受ける必要あり)
 * @param {Number} msec -待機時間(ms) 
 * @returns none(Promise型のオブジェクトを返すけど別に重要じゃない)
 */
const sleep = msec => new Promise(resolve => setTimeout(resolve, msec));

//このファイルがメインモジュールかの確認に用いるらしい
if (require.main === module) {
    main();
}

/**
 * Main関数
 */
function main() {
    printLog(`AppVersion: ${APP_VERSION.major}.${APP_VERSION.minor}.${APP_VERSION.revision}`);

    //とりあえずの実行確認用
    //monitorGoogleRankingHandler();

    try {
        //Google検索順位調査の周期実行
        cron.schedule(CRON_PERIOD_GOOGLE_SEARCH, () => {
            try {
                monitorGoogleRankingHandler();
            } catch (error) {
                printErrLog(`monitorGoogleRankingHandler() throw error ${error}`);
            }
        });
    } catch (error) {
        printErrLog(JSON.stringify(error))
    }
}

/**
 * Google検索、及び結果の記録を実施する
 */
function monitorGoogleRankingHandler() {
    //タイムスタンプ出力
    let recordDateTime = DateTime.now().setZone('Asia/Tokyo');
    printLog(recordDateTime.toISO());

    //googlerバージョンをログに残す
    printLog("googler version: " + execSync(`${GOOGLER_CMD} -v`));

    //設定ファイル読み込み
    confObj = readJsonConfigFile(CONFIG_JSON_FILENAME);
    if (confObj === null) {
        //設定ファイルを正常に読み出せなかった場合
        printErrLog(`readJsonConfigFile(${CONFIG_JSON_FILENAME}) failed.`);
        return;
    }

    //Google検索調査(foreachだと非同期にループを実行してしまい、クエリが連続実行されるため、for文を用いる)
    //foreachにも同期実行的なやつをよこせ！！！
    for (let i = 0; i < confObj.rank_monitored_searches.length; i++) {
        let searchObj = confObj.rank_monitored_searches[i];

        //検索結果取得
        let searchResultList = surveyGoogleRanking(searchObj.search_words, searchObj.url);
        //検索結果記録
        recordSearchResult(searchResultList, i, recordDateTime);
    }
}

/**
 * 指定された検索ワードの配列より、指定されたURLに部分一致するページの検索順位を確認する
 * @param {string} searchWords -検索ワードの配列
 * @param {string} searchUrl -調査対象ページのURL(部分一致)
 * @return {SearchResult} 検索結果の配列(rankの値は、見つからなかった場合は最大検索順位+1の値、エラー発生の場合は-1の値が入る)
 */
async function surveyGoogleRanking(searchWords, searchUrl) {
    let searchResultList = [];

    //検索ワード毎に検索順位を調査(foreachだと非同期にループを実行してしまい、クエリが連続実行されるため、for文を用いる)
    for (let i = 0; i < searchWords.length; i++) {
        let searchWord = searchWords[i];
        let rank = -1; //検索順位

        try {
            /**googlerを実行し、json形式で検索結果を取得 */
            const stdoutJson = execSync(`${GOOGLER_CMD} ${searchWord} -n ${confObj.max_search_rank} --json`);
            const searchResultList = JSON.parse(stdoutJson);

            /**取得したjsonの"url"プロパティを検索し、json配列の何番目に含まれているか探す*/
            rank = searchResultList.findIndex(result => result.url.includes(searchUrl));
            if (rank === -1) {
                //findIndex()にて見つからなかった場合、最大検索順位の+1の値を入れる
                rank = confObj.max_search_rank + 1;
            } else {
                rank += 1; //算出されるrankは0スタートなので、1スタートにしたい
            }
        } catch (err) {
            printErrLog(`surveyGoogleRanking() failed. ${err}`);
            rank = -1;
        }

        printLog(`${searchWord}: rank:${rank}`);
        searchResultList.push(new SearchResult(searchWord, rank));

        //連続でGoogle検索クエリを投げないようにする
        await sleep(GOOGLER_CALL_INTERVAL_MS);
    };

    return searchResultList;
}

/**
 * 検索結果を外部に出力(記録)する
 * @param {SearchResult} searchResultList -検索結果の配列
 * @param {Number} index -記録時に用いるインデックス番号。(config.jsonのrank_monitored_searchesの何番目の結果を格納するのかを指定する)
 * @param {DateTime} recordDateTime -記録時刻(config.jsonのrank_monitored_searchesの何番目の結果を格納するのかを指定する)
 * @return {boolean} 正常に記録できたらtrue, できなかったらfalse
 */
async function recordSearchResult(searchResultList, index, recordDateTime) {

    let targetRow; //書き込み先行番号の格納先
    let recordDateStr; //recordDateTimeを文字列に変換したものを格納


    /*searchResultListの配列長確認*/
    if (searchResultList.length > MAX_SEARCH_RESULT_NUM) {
        printErrLog(`recordSearchResult(): searchResultList.length is over! (MAX:${MAX_SEARCH_RESULT_NUM} length:${searchResultList.length})`);
        return false;
    }


    /*googleスプレッドシート編集初期処理 */
    let gSheet = await open_googleSpreadSheet(confObj.google_sheet_info.file_id, CREDIT_GSHEET_JSON_FILENAME); //
    const sheet = await gSheet.sheetsByIndex[index]; //編集対象のシート指定
    if (sheet === undefined) {
        printErrLog(`recordSearchResult(): Couldn't find a sheet(index:${index})`);
        return false;
    }
    await sheet.loadCells(); //全てのセルをロード(編集対象にする)


    /*記録日時の日付に対応するセルを1行目から順番に探す*/
    for (let row = 0; row < 500; row++) {
        //日付が書かれているであろうセルを取得
        let cellDate = sheet.getCell(row, 0);

        //セルに表示フォーマットの設定がされていなければ例外を投げる
        //(TBD: ここもっとスマートな方法ない！！！？)
        try {
            cellDate.numberFormat.pattern;
        } catch {
            //次の行のセルを検索
            continue;
        }

        //recordDateTimeをセルの表示フォーマットと同様に変換
        recordDateStr = recordDateTime.toFormat(cellDate.numberFormat.pattern) //スプレッドシートの書式に合わせる

        //日付を比較し、適合するセルがあれば探索終了
        if (cellDate.formattedValue === recordDateStr) {
            targetRow = row;
            break;
        }
    }
    //日付のセルが見つからなかった場合
    if (targetRow === undefined) {
        printErrLog(`recordSearchResult(): Couldn't find Date cell(recordDateTime:${recordDateStr})`)
        return false;
    }


    /**指定のセルに結果を書き込む */
    for (let i = 0; i < searchResultList.length; i++) {
        let rankCell = sheet.getCell(targetRow, i + 1); //検索順位書き込み先のセル
        rankCell.value = searchResultList[i].rank;
    }
    await sheet.saveUpdatedCells(); //変更部分をファイルに上書きする

    return true;
}

/**
 * 指定したIDのgoogleスプレッドシートをオブジェクトとして開く
 * (参考URL: https://sonnamonyaro.hatenablog.com/entry/2020/03/01/222650)
 * @param {String} fileId -開きたいgoogleスプレッドシートファイルのID
 * @param {String} creditJsonPath -認証情報が記載されているJSONファイルのパス
 * @return googleスプレッドシートアクセス用オブジェクト
 */
async function open_googleSpreadSheet(fileId, creditJsonPath) {

    const gSheet = new GoogleSpreadsheet(fileId);
    await gSheet.useServiceAccountAuth(require(creditJsonPath)); // 認証
    await gSheet.loadInfo(); // スプレッドシートの読み込み

    return gSheet;
}

//その他関数

/**
 * 本アプリにおける通常ログを出力する関数
 * @param {string} logstr -出力するログ文字列
 * @return none
 */
function printLog(logstr) {
    console.log(`<${APP_NAME}> ${logstr}`);
}

/**
 * 本アプリにおける異常ログを出力する関数
 * @param {string} logstr -出力するログ文字列
 * @return none
 */
function printErrLog(logstr) {
    console.error(`<${APP_NAME}> ${logstr}`);
}

/**
 * 設定ファイル(JSON形式)を読み出し、各種設定値を取得する。設定値の妥当性確認も行う
 * @param {string} jsonFilename -JSON形式の設定ファイルパス
 * @return 正常に設定ファイルを読み出せた場合はJSONオブジェクト。そうでない場合はnull
 */
function readJsonConfigFile(jsonFilePath) {
    let jsonObj = null;
    let undefinedParams = [];

    try {
        //ファイルパスが異常なら、ここでエラーをthrowする
        jsonObj = require(jsonFilePath);
        delete require.cache[require.resolve(jsonFilePath)]; //ここでrequireのキャッシュを削除し、次回以降も再度ファイルを読み出すようにする

        /**以下、設定値の確認 */
        if (jsonObj.google_sheet_info === undefined) {
            undefinedParams.push("google_sheet_info");
        } else {
            //サブパラメータについても確認
            if (jsonObj.google_sheet_info.file_id === undefined) {
                undefinedParams.push("google_sheet_info.file_id");
            }
        }

        if (jsonObj.max_search_rank === undefined) {
            undefinedParams.push("max_search_rank");
        }

        if (jsonObj.rank_monitored_searches === undefined) {
            undefinedParams.push("rank_monitored_searches");
        } else {
            //サブパラメータについても確認
            if (jsonObj.rank_monitored_searches[0].url === undefined) {
                undefinedParams.push("rank_monitored_searches.url");
            }
            if (jsonObj.rank_monitored_searches[0].search_words === undefined) {
                undefinedParams.push("rank_monitored_searches.search_words");
            }
        }

        // 1個以上のパラメータが設定されていなければエラー扱い
        if (undefinedParams.length !== 0) {
            throw `${undefinedParams} is undefined.`;
        }
    } catch (error) {
        printErrLog(error);
        jsonObj = null;
    }

    return jsonObj;
}