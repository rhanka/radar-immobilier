def routes: map({name:.metadata.name,uid:.metadata.uid,spec})|sort_by(.name);
$c[0] as $c | $saved[0] as $s |
$s.binding==$c.binding and $s.image==$c.image
and ($s.ingresses|type=="array" and length>0)
and ([$s.ingresses[].metadata.name]|sort)==($c.maintenance.ingresses|sort)
and ([$s.closedIngresses[].metadata.name]|sort)==($c.maintenance.ingresses|sort)
and all($s.ingresses[]; (.metadata.uid|type=="string" and length>0) and (.spec|type=="object"))
and (($s.ingresses | map(.spec |=
  ((if has("defaultBackend") then .defaultBackend=$deny else . end)|(.rules[]?.http.paths[]?.backend)=$deny)) | routes)
  == ($s.closedIngresses|routes))
and ([.items[].metadata.name]|sort)==($c.maintenance.ingresses|sort)
and all(.items[]; (.metadata.resourceVersion|type=="string" and length>0))
and (.items as $live | all($s.closedIngresses[]; . as $closed |
  ($live[]|select(.metadata.name==$closed.metadata.name)) as $current |
  $current.metadata.uid==$closed.metadata.uid
  and ($current.spec==$closed.spec or ($current.metadata.name==$c.apiIngress
    and $current.spec==($closed.spec * $patch[0].spec)))))
