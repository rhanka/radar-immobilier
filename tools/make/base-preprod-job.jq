       securityContext:{allowPrivilegeEscalation:false,readOnlyRootFilesystem:true,capabilities:{drop:["ALL"]}},
       resources:{requests:{cpu:"100m",memory:"128Mi"},limits:{cpu:"1",memory:"512Mi"}},
       envFrom:[{configMapRef:{name:"radar-api"}}],
       env:([{name:"OPERATOR_IMAGE",value:$c.image}] +
         (["POSTGRES_USER","POSTGRES_PASSWORD","POSTGRES_DB"] | map({name:.,
         valueFrom:{secretKeyRef:{name:"radar-db-credentials",key:.}}}))),
       terminationMessagePolicy:"File",terminationMessagePath:"/dev/termination-log"
     }]}}}}
