'use strict';

//各種パラメータ
const CRON_PERIOD_GOOGLE_SEARCH = "0 0 */1 * *"; //cronによるGoogle検索の周期(cronフォーマット)
const CONFIG_JSON_FILENAME = "./config.json" //設定ファイルの(server.jsから見た)相対パス
const GOOGLER_FILENAME = "./googler" //Google検索を行うPythonスクリプト
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
require('date-utils');


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
    monitorGoogleRankingHandler();

    try {
        //Google検索順位調査の周期実行
        cron.schedule(CRON_PERIOD_GOOGLE_SEARCH, () => {
            printLog(new Date().toFormat(`YYYY/MM/DD/ HH:24MI:SS`));
            monitorGoogleRankingHandler();
        });
    } catch (error) {
        printErrLog(JSON.stringify(error))
    }
}

/**
 * Google検索、及び結果の記録を実施する
 */
function monitorGoogleRankingHandler() {

    //設定ファイル読み込み
    confObj = readJsonConfigFile(CONFIG_JSON_FILENAME);
    if (confObj === null) {
        //設定ファイルを正常に読み出せなかった場合
        printErrLog(`readJsonConfigFile(${CONFIG_JSON_FILENAME}) failed.`);
        return;
    }

    //Google検索調査
    confObj.rank_monitored_searches.forEach((searchObj) => {
        //検索結果取得
        let searchResultList = surveyGoogleRanking(searchObj.search_words, searchObj.url);
        //検索結果記録
        exportSearchResult(searchResultList);
    });
}

/**
 * 指定された検索ワードの配列より、指定されたURLに部分一致するページの検索順位を確認する
 * @param {string} searchWords -検索ワードの配列
 * @param {string} searchUrl -調査対象ページのURL(部分一致)
 * @return {SearchResult} 検索結果の配列(rankの値は、見つからなかった場合は最大検索順位+1の値、エラー発生の場合は-1の値が入る)
 */
function surveyGoogleRanking(searchWords, searchUrl) {

    let searchResultList = null;

    searchWords.forEach((searchWord) => {
        //検索キーワードでgoogle検索
        let rank = -1;

        try {
            const stdoutJson = execSync(`${GOOGLER_FILENAME} ${searchWord} -n ${confObj.max_search_rank} --json`); //googler実行(json形式で標準出力)
            const searchResultList = JSON.parse(stdoutJson);
            rank = searchResultList.findIndex(result => result.url.includes(searchUrl)); //出力されるjsonの"url"プロパティを検索し、配列の何番目に含まれているか探す
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
    });

    return searchResultList;
}

/**
 * 検索結果を外部に出力(記録)する
 * @param {SearchResult} searchResultList -検索結果の配列
 */
function exportSearchResult(searchResultList) {

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
        if (jsonObj.google_sheets_info === undefined) {
            undefinedParams.push("google_sheets_info");
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
            throw `${undefinedParams} is undefined.`
        }
    } catch (error) {
        printErrLog(error);
        jsonObj = null;
    }

    return jsonObj;
}