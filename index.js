const AWS = require('aws-sdk');
const proxy = require('proxy-agent');
AWS.config.update({
  retryDelayOptions: {base: 10000},
  maxRetries: 10,
});
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  AWS.config.update({
    httpOptions: {
      agent: proxy(proxyUrl)
    }
  });
}
/**
 * Main function that set OAuth scopes
 * @param {Object} serverless Serverless object
 */
const setOAuthScopes = async function setOAuthScopes(serverless) {
  const awsCredentials = serverless.getProvider('aws').getCredentials();
  const region = serverless.getProvider('aws').getRegion();
  const stage = serverless.service.provider.stage;
  const serviceName = serverless.service.getServiceName();
  const apiName = stage + '-' + serviceName;

  const apigateway = new AWS.APIGateway({
    credentials: awsCredentials.credentials,
    region
  });

  // FIXME support 500+ APIs
  // get restApiId of service defined in serverless.yml
  var resp = await apigateway.getRestApis({limit: 500}).promise();
  var restApiId = resp.items[resp.items.findIndex(item=>(item.name==apiName))].id;
  var foundDiff = false;

  for (key in serverless.service.functions) {
    if (serverless.service.functions[key].events) {
      for (e of serverless.service.functions[key].events) {
        if (e['http']) {
          var path = '/'+e['http'].path;
          var method = e['http'].method.toUpperCase();
          var scopes = e['http'].scopes;

          serverless.cli.consoleLog(`AWSOAuthScope: ${path} : ${method} : ${scopes}`);  

          // get resource id
          resp = await apigateway.getResources({restApiId: restApiId, limit: 500}).promise();
          var resourceId = resp.items[resp.items.findIndex(item=>(item.path==path))].id;
          await delay(100);

          // get method
          resp = await apigateway.getMethod({
            restApiId: restApiId, 
            resourceId: resourceId, 
            httpMethod: method
          }).promise();

          // check if there are changes
          if (join(scopes) === join(resp.authorizationScopes)) {
            continue;
          } else {
            foundDiff = true;
          }

          var patchOperations = [];
          // remove existing scopes
          if (resp.authorizationScopes) {
            for (let s of resp.authorizationScopes)
              patchOperations.push({
                op: 'remove',
                path: '/authorizationScopes',
                value: s
              });
          }
          // add new scopes
          if (scopes) {
            for (let s of scopes)
              patchOperations.push({
                op: 'add',
                path: '/authorizationScopes',
                value: s
              });
          }
          // update method
          params = {
            restApiId: restApiId,
            resourceId: resourceId,
            httpMethod: method,
            patchOperations: patchOperations
          };
          resp = await apigateway.updateMethod(params).promise();
          await delay(100);
        }
      }
    }
  }

  // create new deployment if there were changes
  if (foundDiff) {
    await apigateway.createDeployment({restApiId: restApiId, stageName: stage}).promise();
  }
};

async function delay(time) {
  return new Promise(function(resolve, reject) {
    setTimeout(resolve, time);
  })
}

function join(arr) {
  return arr ? arr.join(' ') : '';
}

/**
 * The class that will be used as serverless plugin.
 */
class AWSOAuthScopes {
  constructor(serverless, options) {
    this.options = options;
    this.hooks = {
      'after:deploy:deploy': function () {
        setOAuthScopes(serverless);
      }
    };
  }
}

module.exports = AWSOAuthScopes;