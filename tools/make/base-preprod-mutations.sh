  esac
  rg -qF "$expected" "$out/$mutant.log" || { cat "$out/$mutant.log" >&2; exit 1; }
  printf 'KILLED %s\n' "$mutant"
done
bash tools/make/base-preprod-operator.test.sh > "$out/restored.log" 2>&1
echo 'PASS twelve operator mutations; baseline/restored exit 0, each mutant exit nonzero for its expected assertion'
