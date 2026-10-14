#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
command -v python3 >/dev/null
command -v node >/dev/null
for source in assets/wallet.js assets/app.js assets/theme.js assets/touch.js assets/data.js assets/mobile-pages.js assets/news-paper.js assets/news.js backtest/app.js; do
  node --check "$source"
done
python_checks=(test_company_batch test_library_transfer test_asset_library test_profile_cached_serving test_brand_discovery test_default_account_layout test_wallet_state test_release_versions test_public_asset_cache test_generic_company_profiles test_quote_recovery test_accounts test_market_store test_ashare_market test_curated_profiles test_progressive_profiles test_asset_data_pipeline test_research_jobs)
for check in "${python_checks[@]}"; do
  python3 -m unittest discover -s tests -p "${check}.py" </dev/null
done
checks=(
  wallet default-account-groups boot-account-retry market-signal asset-image-cache asset-profile-cache public-cache news-paper mobile-page-back deck-swipe-resistance mobile-entry mobile-entry-art mobile-entry-priority mobile-live-height mobile-keyboard mobile-audio
  mobile-card-render mobile-card-analysis mobile-pet-world pet-world-rotation
  mobile-pet-search mobile-search-parity mobile-pouch logo-loading logo-resolution
  brief-asset-summary ashare-ui data strategy insight gesture audit research-navigation research-presets
)
for check in "${checks[@]}"; do
  node "tests/${check}.test.cjs"
done
printf '%s\n' '移动端、图标持久化、A 股身份与核心分析检查全部通过。'
