  else
    printf 'FAILED %s\n' "$target" >&2
    tail -n 30 "$out/$target.log" >&2
    exit 1
  fi
done
if command -v actionlint >/dev/null; then
  actionlint .github/workflows/build-push-images.yml > "$out/actionlint.log" 2>&1
  echo 'PASSED actionlint'
else
  echo 'SKIPPED actionlint: binary unavailable' | tee "$out/actionlint.log"
fi
sha256sum "$out/"*.log "$out/preprod.yaml" "$out/prod.yaml" > "$out/verification.sha256"
