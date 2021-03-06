# ab_google_ranking_monitoring
Google検索順位監視アプリ。指定した検索ワードにおける、あるWebページのGoogle検索順位が何位かを定期的に監視するアプリ


# 目次
### 1.[概要](#anchor1)
### 2.[システム構成](#anchor2)
### 3.[機能一覧](#anchor3)
### 4.[使用方法](#anchor4)


<a id="anchor1"></a><br>    

## 1. 概要
---
Google検索順位監視アプリ(以下、検索順位監視アプリ)は、監視対象のWebページに対し、任意の検索ワードに対するGoogle検索順位が何位かを定期的に監視するNode.jsアプリケーションである。  
本アプリでは、PythonスクリプトのOSS`googler`を用いてGoogle検索結果を取得し、検索順位を確認する。  
(googlerのGitHub URL:https://github.com/jarun/googler)


<a id="anchor2"></a><br>    

## 2. システム構成
---
 本アプリが動作するシステム構成図を以下に示す。
TBD

| No. | 名称                     | 説明                                                                                                                     |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Google検索順位監視アプリ | 本アプリ<br> Node.jsにて開発                                                                                             |
| 2   | googler                  | PythonスクリプトのOSS"googler"を示す。2021年8月現在使用しているバージョンはv4.3.2<br>ライセンスはGPLv3                   |
| 3   | Linuxサーバ              | 検索順位監視アプリを動作させるLinux環境<br> Google Cloud PlatformのCoumnpute Engineサービスを使用<br>Ubuntu 20.04 LTS    |
| 4   | Googleサーバ             | Googleが運営しているサーバ。以下の処理に用いる<br>1.Google検索結果の取得先<br>2.Googleスプレッドシートへの検索順位の記録 |

<a id="anchor3"></a><br>    
## 3. 機能一覧
---
以下に死活監視アプリの機能一覧を示す。

| No. | 機能名               | 説明                                                                           |
| --- | -------------------- | ------------------------------------------------------------------------------ |
| 1   | Google検索順位監視   | 監視対象のWebページのGoogle検索順位を定期的に取得する機能                      |
| 2   | 結果記録             | 「Google検索順位監視」機能にて取得した検索順位情報を外部ファイルに出力する機能 |
| 3   | 設定ファイル読み出し | 設定ファイルから各種パラメータを読み出す機能                                   |
<br>

### 3.1. Google検索順位監視  
「Google検索順位監視」は、監視対象のWebページのGoogle検索順位を定期的に取得する機能である。Google検索順位の取得には、PythonスクリプトのOSS`googler`を用いる。  
「Google検索順位監視」を実施するタイミングは、毎日のAM 00:30(JST)に実施する。  
「Google検索順位監視」の手順を以下に示す。 

 * 後述の「設定ファイル読み出し」を実施し、検索ワードや監視対象URLを設定ファイルから読み出す
 * `googler`を検索順位監視アプリから実行して、検索ワードにて検索を行い、その結果を取得する。`googler`にはGoogle検索結果をJSON形式にて出力するオプションがあり、本機能ではそのオプションを使用する。 `googler`実行時のコマンドライン引数は以下の通り。
 ```
 googler {検索ワード} -n {最大取得検索件数} --json
 ```
 (※{}内のパラメータは設定ファイルから取得した値が入る)  
 * `googler`が出力したJSON形式の検索結果の内、"url"プロパティに監視対象URL文字列を**含む**(部分一致)検索結果が存在するかを確認する
    * 存在する場合、その検索結果の順位を監視対象のWebページのGoogle検索順位とする(順位は1スタートとする)
    * 存在しない場合、{最大取得検索件数}+1の値をGoogle検索順位とする
<br>
### 3.2. 結果記録  
「結果記録」は、「Google検索順位監視」にて取得したGoogle検索順位を外部ファイルに出力する機能である。記録先はGoogleスプレッドシートを使用する。
「結果記録」は、「Google検索順位監視」の実施後合わせて都度実施する。
Googleスプレッドシートには、
<br>