import * as amplify from '@aws-cdk/aws-amplify';
import * as cdk from '@aws-cdk/core';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as logs from '@aws-cdk/aws-logs';
import * as ssm from '@aws-cdk/aws-ssm';

export class ThrustinCdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

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
              commands: [
                'npm install',
                'npm run build-prod'
              ]
            }
          },
          artifacts: {
            baseDirectory: 'build',
            files: [
              '**/*'
            ]
          },
          cache: {
            paths: [
              'node_modules/**/*'
            ]
          }
        }
      })
    });
    const branch = amplifyApp.addBranch('master');
    const domain = amplifyApp.addDomain('maxrchung.com')
    domain.mapSubDomain(branch, 'thrustin');

    const taskDefinition = new ecs.TaskDefinition(this, 'thrustin-task', {
      family: 'thrustin-task',
      compatibility: ecs.Compatibility.FARGATE,
      cpu: '256',
      memoryMiB: '512',
    });

    const logGroup = new logs.LogGroup(this, 'thrustin-log-group', {
      logGroupName: 'thrustin-log-group',
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const container = taskDefinition.addContainer('thrustin-container', {
      containerName: 'thrustin-container',
      image: ecs.ContainerImage.fromRegistry('maxrchung/thrustin'),
      environment: {
        DATABASE_CONNECTION_STRING: ssm.StringParameter.valueForStringParameter(this, 'thrustin-database-url'),
      },
      logging: ecs.LogDriver.awsLogs({
        logGroup: logGroup,
        streamPrefix: 'thrustin-log',
      })
    });

    container.addPortMappings({ containerPort: 3012 });

    const vpc = ec2.Vpc.fromLookup(this, 'cloud-vpc', {
      vpcName: 'cloud-vpc',
    });

    // https://github.com/aws/aws-cdk/issues/11146#issuecomment-943495698
    const cluster = ecs.Cluster.fromClusterAttributes(this, 'cloud-cluster', {
      clusterName: 'cloud-cluster',
      vpc,
      securityGroups: [],
    });

    const fargate = new ecs.FargateService(this, 'thrustin-fargate', {
      serviceName: 'thrustin-fargate',
      cluster,
      desiredCount: 1,
      taskDefinition,
      assignPublicIp: true,
    });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'thrustin-target-group', {
      targetGroupName: 'thrustin-target-group',
      port: 3012,
      vpc,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });

    targetGroup.configureHealthCheck({
      // There is no health check endpoint on the backend. When you try and hit the root,
      // the backend is returning a 400 as it expects a websocket connection.
      healthyHttpCodes: "200,400",
      // Make logging less filled with web socket connection errors, max value is 300
      interval: cdk.Duration.seconds(300),
    });

    targetGroup.addTarget(fargate);

    const listener = elbv2.ApplicationListener.fromLookup(this, 'cloud-balancer-listener-https', {
      loadBalancerTags: {
        'balancer-identifier': 'cloud-balancer'
      },
      listenerProtocol: elbv2.ApplicationProtocol.HTTPS,
    });

    listener.addTargetGroups('add-thrustin-target-group', {
      priority: 200,
      targetGroups: [
        targetGroup
      ],
      conditions: [
        elbv2.ListenerCondition.hostHeaders([
          'thrustin.server.maxrchung.com',
        ]),
      ],
    });
  }
}
