import * as amplify from '@aws-cdk/aws-amplify'
import * as cdk from '@aws-cdk/core'
import * as codebuild from '@aws-cdk/aws-codebuild'
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2'
import * as ecs from '@aws-cdk/aws-ecs'
import * as ec2 from '@aws-cdk/aws-ec2'
import * as logs from '@aws-cdk/aws-logs'
import * as ssm from '@aws-cdk/aws-ssm'

export class ThrustinCdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const amplifyApp = new amplify.App(this, 'thrustin-amplify', {
      sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
        owner: 'maxrchung',
        repository: 'THRUSTIN',
        oauthToken: cdk.SecretValue.plainText(ssm.StringParameter.valueForStringParameter(this, 'github-personal-access-token'))
      }),
      buildSpec: codebuild.BuildSpec.fromObjectToYaml({
        version: '1.0',
        appRoot: 'frontend',
        frontend: {
          phases: {
            build: {
              commands: ['npm install', 'npm run build-prod']
            }
          },
          artifacts: {
            baseDirectory: 'build',
            files: ['**/*']
          },
          cache: {
            paths: ['node_modules/**/*']
          }
        }
      })
    })
    const branch = amplifyApp.addBranch('master')
    const domain = amplifyApp.addDomain('maxrchung.com')
    domain.mapSubDomain(branch, 'thrustin')
  }
}
