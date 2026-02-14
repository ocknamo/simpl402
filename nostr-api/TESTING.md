# x402 + NIP-58 Badge Award System - 動作確認手順

このドキュメントでは、x402 over Lightning Network + NIP-58 Badge Award APIの動作確認手順の概要を説明します。

## 前提条件

- 開発サーバーが起動していること (`npm run dev`)
- `curl`, `jq`, `base64` コマンドが利用可能であること
- `.dev.vars` ファイルに必要な環境変数が設定されていること

## 環境変数の確認

テストを開始する前に、必要な環境変数が設定されていることを確認します。

```bash
cat .dev.vars
```

必要な環境変数:
- `COINOS_API_KEY`: coinos.io APIキー
- `COINOS_API_URL`: `https://coinos.io/api`
- `INVOICE_AMOUNT_SATS`: `100`
- `INVOICE_EXPIRY_SECONDS`: `3600`
- `BADGE_ISSUER_NSEC`: バッジ発行者のNostr秘密鍵（nsec形式）

## 開発サーバーの起動

### 方法1: フォアグラウンド起動（手動テスト時）

```bash
cd /home/yoshiki/workspace/ln/simpl402/nostr-api
npm run dev
```

サーバーが `http://localhost:8787` で起動します。ログはターミナルに直接表示されます。

### 方法2: バックグラウンド起動（AI自動テスト時の推奨方法）

AIがテストを自動実行する場合、サーバーをバックグラウンドで起動し、ログをファイルに出力する方法を推奨します：

```bash
cd /home/yoshiki/workspace/ln/simpl402/nostr-api

# ログディレクトリの作成（初回のみ）
mkdir -p logs

# タイムスタンプ付きログファイル名でバックグラウンド起動
LOG_FILE="logs/server-$(date +%Y%m%d-%H%M%S).log"
nohup npm run dev > "$LOG_FILE" 2>&1 &

echo "Server started. Log file: $LOG_FILE"
```

この方法により：
- ✅ サーバーがバックグラウンドで実行され、テストコマンドが同じターミナルで実行可能
- ✅ ログが `logs/` ディレクトリに保存され、後から確認可能
- ✅ ログファイル名がタイムスタンプ付きでユニーク（上書きされない）
- ✅ テスト実行時にターミナルが待機状態にならない

**ログの確認:**
```bash
# 最新のログをリアルタイムで確認
tail -f logs/server-*.log

# 最新ログファイルの全体を確認
cat logs/server-*.log | tail -50
```

**サーバーの停止:**
```bash
# wranglerプロセスを停止
pkill -f "wrangler dev"

# または、プロセスIDを確認してから停止
ps aux | grep wrangler
kill <プロセスID>
```

### 方法3: 複数ターミナル方式

複数のターミナルを使用してサーバーログをリアルタイムで確認する場合：

**ターミナル1（サーバー起動用）:**
```bash
cd /home/yoshiki/workspace/ln/simpl402/nostr-api
npm run dev
```

**ターミナル2（テスト実行用）:**
```bash
cd /home/yoshiki/workspace/ln/simpl402/nostr-api
# ここでテストコマンド（curl等）を実行
```

---

## テストケース

各テストケースは個別のファイルに分離されています。以下のリンクから各テストケースの詳細を確認してください。

### [テストケース1: GET /test/uuid (デモエンドポイント)](./test/test-case-1.md)

x402で保護された UUID v4 生成エンドポイントのテストです。

**確認できる機能:**
- 402 Payment Requiredレスポンス
- PAYMENT-REQUIREDヘッダー（x402 v2形式）
- PAYMENT-SIGNATUREヘッダー
- PAYMENT-RESPONSEヘッダー
- Lightning Network支払い検証
- インボイス再利用防止（Cloudflare KV）

**実行方法:**
```bash
# test/test-case-1.md を参照してください
```

---

### [テストケース2: POST /nostr/badge-challenge (NIP-58 Badge Award)](./test/test-case-2.md)

支払い後にNIP-58バッジを発行するエンドポイントのテストです。

**デフォルトテスト用npub:**
```bash
npub19dzc258s3l8ht547cktvqsgura8wj0ecyr02a9g6zgxq9r3scjqqqrg7sk
```

**確認できる機能:**
- NIP-58 Badge Awardイベント発行
- npub形式のバリデーション
- 誤課金防止設計（事前検証）
- x402プロトコル（v2準拠）
- Lightning Network支払い検証
- インボイス再利用防止

**実行方法:**
```bash
# test/test-case-2.md を参照してください
```

---

## エラーハンドリング

### 存在しないエンドポイント

```bash
curl -i http://localhost:8787/invalid/path
```

**期待される結果:**
```
HTTP/1.1 404 Not Found

Not Found
```

### 金額不一致エラー

実装では、インボイスの金額が期待値（100 sats）と異なる場合にエラーを返します。
この検証は実装内部で自動的に行われます。

---

## 全体のまとめ

すべてのテストケースを実行することで、以下の機能が正常に動作していることを確認できます：

### x402プロトコル（v2準拠）
1. ✅ 402 Payment Requiredレスポンスの生成
2. ✅ PAYMENT-REQUIREDヘッダー（resource, accepts配列）
3. ✅ PAYMENT-SIGNATUREヘッダー（x402 v2形式）
4. ✅ PAYMENT-RESPONSEヘッダー（success/failure settlement）
5. ✅ 支払い検証（coinos.io API連携）
6. ✅ インボイス再利用防止（Cloudflare KV）
7. ✅ インボイス有効期限チェック
8. ✅ 金額検証

### NIP-58 Badge Award
1. ✅ バッジアワードイベント（kind 8）の作成
2. ✅ イベント署名（バッジ発行者秘密鍵）
3. ✅ Nostrリレーへの公開（非同期、`ctx.waitUntil`）
4. ✅ npub形式のバリデーション

### 誤課金防止設計
1. ✅ リクエストボディの事前検証（支払い前）
2. ✅ 無効な入力でのエラーレスポンス（400 Bad Request）
3. ✅ 検証成功後のみ課金要求（402 Payment Required）

### セキュリティ
1. ✅ 環境変数による秘密情報管理
2. ✅ インボイス重複チェック
3. ✅ 支払いハッシュ検証

すべての確認項目が期待通りの結果になれば、APIは正常に動作しています！

---

## トラブルシューティング

### サーバーが起動しない

```bash
# 依存関係を再インストール
npm install

# 開発サーバーを再起動
npm run dev
```

### 環境変数が設定されていない

`.dev.vars` ファイルが存在し、必要な環境変数が設定されているか確認してください。

```bash
cat .dev.vars
```

### coinos.io API呼び出しでエラーが発生する

- `COINOS_API_KEY` が正しく設定されているか確認
- coinos.ioアカウントにログインして、APIキーが有効か確認
- 開発サーバーのログを確認（`[DEBUG]` で始まる行）

### BADGE_ISSUER_NSECエラー

- `BADGE_ISSUER_NSEC` が `nsec1...` 形式で設定されているか確認
- 有効なNostr秘密鍵であることを確認

### jqコマンドが見つからない

```bash
# jqをインストール（Debian/Ubuntu）
sudo apt install jq
```

---

## テストファイルの構成

```
nostr-api/
├── TESTING.md                    # このファイル（概要・共通設定）
└── test/
    ├── test-case-1.md            # テストケース1の詳細手順
    └── test-case-2.md            # テストケース2の詳細手順
```

各テストケースは独立して実行可能です。必要なテストケースのみを選択して実行できます。
