def images: [.containers[]?,.initContainers[]?]|map({name,image});
.deployments=[$d[0].items[]|select(.metadata.name!="radar-postgres")|
  {name:.metadata.name,uid:.metadata.uid,replicas:(.spec.replicas//1),images:(.spec.template.spec|images)}]
| .cronjobs=[$c[0].items[]|{name:.metadata.name,uid:.metadata.uid,suspend:.spec.suspend,
    images:(.spec.jobTemplate.spec.template.spec|images)}]
| .ingresses=[$i[0].items[]|select(.metadata.labels["acme.cert-manager.io/http01-solver"]!="true")|
    {name:.metadata.name,uid:.metadata.uid,spec}]
| .environment=$env
