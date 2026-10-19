#!/bin/sh
# prepare_signing.sh — 在 CI 里落地固定的 debug 签名密钥
#
# 背景：GitHub Actions 每次都在全新 runner 上跑，~/.android/debug.keystore
# 不存在，Gradle 于是每次现场生成一把新钥匙。Android 拒绝覆盖签名不同的包，
# 所以每个新 APK 都装不上旧版（"应用未安装"）。
#
# 密钥库不进仓库（这是公开仓库），由 CI 从 secrets 注入：
#   KS_B64      密钥库文件的 base64
#   KS_PASS     密钥库口令
#   KS_ALIAS    key alias
#   KS_KEYPASS  key 口令
#
# 没有配置 secret 时直接退出 0，构建退回默认 debug key —— 本地/其他 fork 不会因此失败。
set -e

if [ -z "$KS_B64" ]; then
    echo "no signing key configured; using the default debug key"
    exit 0
fi

mkdir -p android/app/keystore
printf '%s' "$KS_B64" | base64 -d > android/app/keystore/ss-debug.p12

# 路径相对 android/app/build.gradle 解析
printf 'storeFile=keystore/ss-debug.p12\n' > android/keystore.properties
printf 'storePassword=%s\n' "$KS_PASS" >> android/keystore.properties
printf 'keyAlias=%s\n' "$KS_ALIAS" >> android/keystore.properties
printf 'keyPassword=%s\n' "$KS_KEYPASS" >> android/keystore.properties

ls -l android/app/keystore/ss-debug.p12 android/keystore.properties
