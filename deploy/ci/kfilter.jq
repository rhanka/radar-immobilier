# Match the legacy scanner's first canonical kind/name field; retain YAML bytes.
def field($pattern): [split("\n")[] | match($pattern) | .captures[0].string][0];
gsub("\r\n?"; "\n")
| ("\n" + .) | split("\n---[ \t]*(?=\n|$)"; "")
| map(select(test("\\S"))
      | select(field("^kind:[ \t]+(\\S+)[ \t]*$") == $kind)
      | {name: (field("^  name:[ \t]+(\\S+)[ \t]*$") // ""),
         text: gsub("\\A\\n+|\\n+\\z"; "")}
      | select(($exact | not) or .name == $name)
      | select(.name | startswith($prefix)))
| if $names then map(.name + "\n") | join("")
  else map(.text) | join("\n---\n") | if . == "" then . else . + "\n" end
  end
