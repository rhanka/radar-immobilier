length == 59017
and (map(.size) | add) == 12534514457
and ([.[].key] | length) == ([.[].key] | unique | length)
and all(.[];
  (.key | type) == "string"
  and (.sha256 | test("^[0-9a-f]{64}$")))
