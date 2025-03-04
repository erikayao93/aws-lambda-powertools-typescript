---
title: Idempotency
description: Utility
---

???+ warning
	**This utility is currently released as beta developer preview** and is intended strictly for feedback and testing purposes **and not for production workloads**. The version and all future versions tagged with the `-beta` suffix should be treated as not stable. Up until before the [General Availability release](https://github.com/aws-powertools/powertools-lambda-typescript/milestone/7) we might introduce significant breaking changes and improvements in response to customers feedback.

The idempotency utility provides a simple solution to convert your Lambda functions into idempotent operations which are safe to retry.

## Key features

* Prevent Lambda handler from executing more than once on the same event payload during a time window
* Ensure Lambda handler returns the same result when called with the same payload
* Select a subset of the event as the idempotency key using JMESPath expressions
* Set a time window in which records with the same payload should be considered duplicates
* Expires in-progress executions if the Lambda function times out halfway through

## Terminology

The property of idempotency means that an operation does not cause additional side effects if it is called more than once with the same input parameters.

**Idempotent operations will return the same result when they are called multiple times with the same parameters**. This makes idempotent operations safe to retry.

**Idempotency key** is a hash representation of either the entire event or a specific configured subset of the event, and invocation results are **JSON serialized** and stored in your persistence storage layer.

**Idempotency record** is the data representation of an idempotent request saved in your preferred  storage layer. We use it to coordinate whether a request is idempotent, whether it's still valid or expired based on timestamps, etc.

<center>
```mermaid
classDiagram
    direction LR
    class IdempotencyRecord {
        idempotencyKey string
        status Status
        expiryTimestamp number
        inProgressExpiryTimestamp number
        responseData Json~string~
        payloadHash string
    }
    class Status {
        <<Enumeration>>
        INPROGRESS
        COMPLETE
        EXPIRED internal_only
    }
    IdempotencyRecord -- Status
```

<i>Idempotency record representation</i>
</center>

## Getting started

### IAM Permissions

Your Lambda function IAM Role must have `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem` and `dynamodb:DeleteItem` IAM permissions before using this feature.

???+ note
    If you're using one of our examples: [AWS Serverless Application Model (SAM)](#required-resources) or [Terraform](#required-resources) the required permissions are already included.

### Required resources

Before getting started, you need to create a persistent storage layer where the idempotency utility can store its state - your lambda functions will need read and write access to it.

As of now, Amazon DynamoDB is the only supported persistent storage layer, so you'll need to create a table first.

**Default table configuration**

If you're not [changing the default configuration for the DynamoDB persistence layer](#dynamodbpersistencelayer), this is the expected default configuration:

| Configuration      | Value        | Notes                                                                               |
| ------------------ | ------------ | ----------------------------------------------------------------------------------- |
| Partition key      | `id`         |
| TTL attribute name | `expiration` | This can only be configured after your table is created if you're using AWS Console |

???+ tip "Tip: You can share a single state table for all functions"
    You can reuse the same DynamoDB table to store idempotency state. We add the Lambda function name in addition to the idempotency key as a hash key.

<!-- TODO: review CDK template -->
=== "AWS Serverless Application Model (SAM) example"

    ```yaml hl_lines="6-14 24-31"
    Transform: AWS::Serverless-2016-10-31
    Resources:
    IdempotencyTable:
        Type: AWS::DynamoDB::Table
        Properties:
        AttributeDefinitions:
            - AttributeName: id
            AttributeType: S
        KeySchema:
            - AttributeName: id
            KeyType: HASH
        TimeToLiveSpecification:
            AttributeName: expiration
            Enabled: true
        BillingMode: PAY_PER_REQUEST

    HelloWorldFunction:
        Type: AWS::Serverless::Function
        Properties:
        Runtime: nodejs18.x
        Handler: index.handler
        Policies:
            - Statement:
            - Sid: AllowDynamodbReadWrite
                Effect: Allow
                Action:
                - dynamodb:PutItem
                - dynamodb:GetItem
                - dynamodb:UpdateItem
                - dynamodb:DeleteItem
                Resource: !GetAtt IdempotencyTable.Arn
    ```

=== "Terraform"

    ```terraform hl_lines="14-26 64-70"
    terraform {
        required_providers {
            aws = {
            source  = "hashicorp/aws"
            version = "~> 4.0"
            }
        }
    }

    provider "aws" {
        region = "us-east-1" # Replace with your desired AWS region
    }

    resource "aws_dynamodb_table" "IdempotencyTable" {
        name         = "IdempotencyTable"
        billing_mode = "PAY_PER_REQUEST"
        hash_key     = "id"
        attribute {
            name = "id"
            type = "S"
        }
        ttl {
            attribute_name = "expiration"
            enabled        = true
        }
    }

    resource "aws_lambda_function" "IdempotencyFunction" {
        function_name = "IdempotencyFunction"
        role          = aws_iam_role.IdempotencyFunctionRole.arn
        runtime       = "nodejs18.x"
        handler       = "index.handler"
        filename      = "lambda.zip"
    }

    resource "aws_iam_role" "IdempotencyFunctionRole" {
        name = "IdempotencyFunctionRole"

        assume_role_policy = jsonencode({
            Version = "2012-10-17"
            Statement = [
            {
                Sid    = ""
                Effect = "Allow"
                Principal = {
                Service = "lambda.amazonaws.com"
                }
                Action = "sts:AssumeRole"
            },
            ]
        })
    }

    resource "aws_iam_policy" "LambdaDynamoDBPolicy" {
        name        = "LambdaDynamoDBPolicy"
        description = "IAM policy for Lambda function to access DynamoDB"
        policy = jsonencode({
            Version = "2012-10-17"
            Statement = [
            {
                Sid    = "AllowDynamodbReadWrite"
                Effect = "Allow"
                Action = [
                "dynamodb:PutItem",
                "dynamodb:GetItem",
                "dynamodb:UpdateItem",
                "dynamodb:DeleteItem",
                ]
                Resource = aws_dynamodb_table.IdempotencyTable.arn
            },
            ]
        })
    }

    resource "aws_iam_role_policy_attachment" "IdempotencyFunctionRoleAttachment" {
        role       = aws_iam_role.IdempotencyFunctionRole.name
        policy_arn = aws_iam_policy.LambdaDynamoDBPolicy.arn
    }
    ```

???+ warning "Warning: Large responses with DynamoDB persistence layer"
    When using this utility with DynamoDB, your function's responses must be [smaller than 400KB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Limits.html#limits-items){target="_blank"}.

    Larger items cannot be written to DynamoDB and will cause exceptions.

???+ info "Info: DynamoDB"
    Each function invocation will generally make 2 requests to DynamoDB. If the
    result returned by your Lambda is less than 1kb, you can expect 2 WCUs per invocation. For retried invocations, you will
    see 1WCU and 1RCU. Review the [DynamoDB pricing documentation](https://aws.amazon.com/dynamodb/pricing/){target="_blank"} to
    estimate the cost.

### MakeIdempotent function wrapper

You can quickly start by initializing the `DynamoDBPersistenceLayer` class and using it with the `makeIdempotent` function wrapper on your Lambda handler.

???+ note
    In this example, the entire Lambda handler is treated as a single idempotent operation. If your Lambda handler can cause multiple side effects, or you're only interested in making a specific logic idempotent, use the `makeIdempotent` high-order function only on the function that needs to be idempotent.

!!! tip "See [Choosing a payload subset for idempotency](#choosing-a-payload-subset-for-idempotency) for more elaborate use cases."

=== "index.ts"

    ```typescript hl_lines="2-3 21 35-38"
    --8<-- "docs/snippets/idempotency/makeIdempotentBase.ts"
    ```

=== "Types"

    ```typescript
    --8<-- "docs/snippets/idempotency/types.ts::13"
    ```

After processing this request successfully, a second request containing the exact same payload above will now return the same response, ensuring our customer isn't charged twice.

!!! question "New to idempotency concept? Please review our [Terminology](#terminology) section if you haven't yet."

You can also use the `makeIdempotent` function wrapper on any function that returns a response to make it idempotent. This is useful when you want to make a specific logic idempotent, for example when your Lambda handler performs multiple side effects and you only want to make a specific one idempotent.

???+ warning "Limitation"
    Make sure to return a JSON serializable response from your function, otherwise you'll get an error.

When using `makeIdempotent` on arbitrary functions, you can tell us which argument in your function signature has the data we should use via **`dataIndexArgument`**. If you don't specify this argument, we'll use the first argument in the function signature.

???+ note
    The function in the example below has two arguments, note that while wrapping it with the `makeIdempotent` high-order function, we specify the `dataIndexArgument` as `1` to tell the decorator that the second argument is the one that contains the data we should use to make the function idempotent. Remember that arguments are zero-indexed, so the first argument is `0`, the second is `1`, and so on.

=== "index.ts"

    ```typescript hl_lines="22 34-38"
    --8<-- "docs/snippets/idempotency/makeIdempotentAnyFunction.ts"
    ```

=== "Types"

    ```typescript
    --8<-- "docs/snippets/idempotency/types.ts::13"
    ```

### MakeHandlerIdempotent Middy middleware

!!! tip "A note about Middy"
        Currently we support only Middy `v3.x` that you can install it by running `npm i @middy/core@~3`.
        Check their docs to learn more about [Middy and its middleware stack](https://middy.js.org/docs/intro/getting-started){target="_blank"} as well as [best practices when working with Powertools](https://middy.js.org/docs/integrations/lambda-powertools#best-practices){target="_blank"}.

If you are using [Middy](https://middy.js.org){target="_blank"} as your middleware engine, you can use the `makeHandlerIdempotent` middleware to make your Lambda handler idempotent. Similar to the `makeIdempotent` function wrapper, you can quickly make your Lambda handler idempotent by initializing the `DynamoDBPersistenceLayer` class and using it with the `makeHandlerIdempotent` middleware.

=== "index.ts"

    ```typescript hl_lines="22 36-40"
    --8<-- "docs/snippets/idempotency/makeHandlerIdempotent.ts"
    ```

=== "Types"

    ```typescript
    --8<-- "docs/snippets/idempotency/types.ts::13"
    ```

### Choosing a payload subset for idempotency

???+ tip "Tip: Dealing with always changing payloads"
    When dealing with a more elaborate payload, where parts of the payload always change, you should use the **`eventKeyJmesPath`** parameter.

Use [`IdempotencyConfig`](#customizing-the-default-behavior) to instruct the idempotent decorator to only use a portion of your payload to verify whether a request is idempotent, and therefore it should not be retried.

> **Payment scenario**

In this example, we have a Lambda handler that creates a payment for a user subscribing to a product. We want to ensure that we don't accidentally charge our customer by subscribing them more than once.

Imagine the function executes successfully, but the client never receives the response due to a connection issue. It is safe to retry in this instance, as the idempotent decorator will return a previously saved response.

**What we want here** is to instruct Idempotency to use the `user` and `productId` fields from our incoming payload as our idempotency key. If we were to treat the entire request as our idempotency key, a simple HTTP header or timestamp change would cause our customer to be charged twice.

???+ tip "Deserializing JSON strings in payloads for increased accuracy."
    The payload extracted by the `eventKeyJmesPath` is treated as a string by default. This means there could be differences in whitespace even when the JSON payload itself is identical.

=== "index.ts"

    ```typescript hl_lines="4 26-28 49"
    --8<-- "docs/snippets/idempotency/makeIdempotentJmes.ts"
    ```

=== "Example event"

    ```json hl_lines="28"
    {
      "version":"2.0",
      "routeKey":"ANY /createpayment",
      "rawPath":"/createpayment",
      "rawQueryString":"",
      "headers": {
        "Header1": "value1",
        "X-Idempotency-Key": "abcdefg"
      },
      "requestContext":{
        "accountId":"123456789012",
        "apiId":"api-id",
        "domainName":"id.execute-api.us-east-1.amazonaws.com",
        "domainPrefix":"id",
        "http":{
          "method":"POST",
          "path":"/createpayment",
          "protocol":"HTTP/1.1",
          "sourceIp":"ip",
          "userAgent":"agent"
        },
        "requestId":"id",
        "routeKey":"ANY /createpayment",
        "stage":"$default",
        "time":"10/Feb/2021:13:40:43 +0000",
        "timeEpoch":1612964443723
      },
      "body":"{\"user\":\"xyz\",\"productId\":\"123456789\"}",
      "isBase64Encoded":false
    }
    ```

=== "Types"

    ```typescript
    --8<-- "docs/snippets/idempotency/types.ts::13"
    ```

### Lambda timeouts

???+ note
    This is automatically done when you wrap your Lambda handler with the [makeIdempotent](#makeIdempotent-function-wrapper) function wrapper, or use the [`makeHandlerIdempotent`](#makeHandlerIdempotent-middy-middleware) Middy middleware.

To prevent against extended failed retries when a [Lambda function times out](https://aws.amazon.com/premiumsupport/knowledge-center/lambda-verify-invocation-timeouts/), Powertools for AWS calculates and includes the remaining invocation available time as part of the idempotency record.

???+ example
    If a second invocation happens **after** this timestamp, and the record is marked as `INPROGRESS`, we will execute the invocation again as if it was in the `EXPIRED` state (e.g, `expire_seconds` field elapsed).

    This means that if an invocation expired during execution, it will be quickly executed again on the next retry.

???+ important
    If you are only using the [makeIdempotent function wrapper](#makeIdempotent-function-wrapper) to guard isolated parts of your code, you must use `registerLambdaContext` available in the [idempotency config object](#customizing-the-default-behavior) to benefit from this protection.

Here is an example on how you register the Lambda context in your handler:

=== "Registering Lambda Context"

    ```typescript hl_lines="13 38"
    --8<-- "docs/snippets/idempotency/makeIdempotentLambdaContext.ts"
    ```

### Handling exceptions

If you are making on your entire Lambda handler idempotent, any unhandled exceptions that are raised during the code execution will cause **the record in the persistence layer to be deleted**.
This means that new invocations will execute your code again despite having the same payload. If you don't want the record to be deleted, you need to catch exceptions within the idempotent function and return a successful response.

<center>
```mermaid
sequenceDiagram
    participant Client
    participant Lambda
    participant Persistence Layer
    Client->>Lambda: Invoke (event)
    Lambda->>Persistence Layer: Get or set (id=event.search(payload))
    activate Persistence Layer
    Note right of Persistence Layer: Locked during this time. Prevents multiple<br/>Lambda invocations with the same<br/>payload running concurrently.
    Lambda--xLambda: Call handler (event).<br/>Raises exception
    Lambda->>Persistence Layer: Delete record (id=event.search(payload))
    deactivate Persistence Layer
    Lambda-->>Client: Return error response
```
<i>Idempotent sequence exception</i>
</center>

If you are using `makeIdempotent` on any other function, any unhandled exceptions that are thrown _inside_ the wrapped function will cause the record in the persistence layer to be deleted, and allow the function to be executed again if retried.

If an error is thrown _outside_ the scope of the decorated function and after your function has been called, the persistent record will not be affected. In this case, idempotency will be maintained for your decorated function. Example:

=== "Handling exceptions"

    ```typescript hl_lines="39-40 47-48"
    --8<-- "docs/snippets/idempotency/workingWithExceptions.ts"
    ```

???+ warning
    **We will throw `IdempotencyPersistenceLayerError`** if any of the calls to the persistence layer fail unexpectedly.

    As this happens outside the scope of your decorated function, you are not able to catch it when making your Lambda handler idempotent.

### Idempotency request flow

The following sequence diagrams explain how the Idempotency feature behaves under different scenarios.

#### Successful request

<center>
```mermaid
sequenceDiagram
    participant Client
    participant Lambda
    participant Persistence Layer
    alt initial request
        Client->>Lambda: Invoke (event)
        Lambda->>Persistence Layer: Get or set idempotency_key=hash(payload)
        activate Persistence Layer
        Note over Lambda,Persistence Layer: Set record status to INPROGRESS. <br> Prevents concurrent invocations <br> with the same payload
        Lambda-->>Lambda: Call your function
        Lambda->>Persistence Layer: Update record with result
        deactivate Persistence Layer
        Persistence Layer-->>Persistence Layer: Update record
        Note over Lambda,Persistence Layer: Set record status to COMPLETE. <br> New invocations with the same payload <br> now return the same result
        Lambda-->>Client: Response sent to client
    else retried request
        Client->>Lambda: Invoke (event)
        Lambda->>Persistence Layer: Get or set idempotency_key=hash(payload)
        activate Persistence Layer
        Persistence Layer-->>Lambda: Already exists in persistence layer.
        deactivate Persistence Layer
        Note over Lambda,Persistence Layer: Record status is COMPLETE and not expired
        Lambda-->>Client: Same response sent to client
    end
```
<i>Idempotent successful request</i>
</center>

#### Successful request with cache enabled

!!! note "[In-memory cache is disabled by default](#using-in-memory-cache)."

<center>
```mermaid
sequenceDiagram
    participant Client
    participant Lambda
    participant Persistence Layer
    alt initial request
      Client->>Lambda: Invoke (event)
      Lambda->>Persistence Layer: Get or set idempotency_key=hash(payload)
      activate Persistence Layer
      Note over Lambda,Persistence Layer: Set record status to INPROGRESS. <br> Prevents concurrent invocations <br> with the same payload
      Lambda-->>Lambda: Call your function
      Lambda->>Persistence Layer: Update record with result
      deactivate Persistence Layer
      Persistence Layer-->>Persistence Layer: Update record
      Note over Lambda,Persistence Layer: Set record status to COMPLETE. <br> New invocations with the same payload <br> now return the same result
      Lambda-->>Lambda: Save record and result in memory
      Lambda-->>Client: Response sent to client
    else retried request
      Client->>Lambda: Invoke (event)
      Lambda-->>Lambda: Get idempotency_key=hash(payload)
      Note over Lambda,Persistence Layer: Record status is COMPLETE and not expired
      Lambda-->>Client: Same response sent to client
    end
```
<i>Idempotent successful request cached</i>
</center>

#### Expired idempotency records

<center>
```mermaid
sequenceDiagram
    participant Client
    participant Lambda
    participant Persistence Layer
    alt initial request
        Client->>Lambda: Invoke (event)
        Lambda->>Persistence Layer: Get or set idempotency_key=hash(payload)
        activate Persistence Layer
        Note over Lambda,Persistence Layer: Set record status to INPROGRESS. <br> Prevents concurrent invocations <br> with the same payload
        Lambda-->>Lambda: Call your function
        Lambda->>Persistence Layer: Update record with result
        deactivate Persistence Layer
        Persistence Layer-->>Persistence Layer: Update record
        Note over Lambda,Persistence Layer: Set record status to COMPLETE. <br> New invocations with the same payload <br> now return the same result
        Lambda-->>Client: Response sent to client
    else retried request
        Client->>Lambda: Invoke (event)
        Lambda->>Persistence Layer: Get or set idempotency_key=hash(payload)
        activate Persistence Layer
        Persistence Layer-->>Lambda: Already exists in persistence layer.
        deactivate Persistence Layer
        Note over Lambda,Persistence Layer: Record status is COMPLETE but expired hours ago
        loop Repeat initial request process
            Note over Lambda,Persistence Layer: 1. Set record to INPROGRESS, <br> 2. Call your function, <br> 3. Set record to COMPLETE
        end
        Lambda-->>Client: Same response sent to client
    end
```
<i>Previous Idempotent request expired</i>
</center>

#### Concurrent identical in-flight requests

<center>
```mermaid
sequenceDiagram
    participant Client
    participant Lambda
    participant Persistence Layer
    Client->>Lambda: Invoke (event)
    Lambda->>Persistence Layer: Get or set idempotency_key=hash(payload)
    activate Persistence Layer
    Note over Lambda,Persistence Layer: Set record status to INPROGRESS. <br> Prevents concurrent invocations <br> with the same payload
      par Second request
          Client->>Lambda: Invoke (event)
          Lambda->>Persistence Layer: Get or set idempotency_key=hash(payload)
          Lambda--xLambda: IdempotencyAlreadyInProgressError
          Lambda->>Client: Error sent to client if unhandled
      end
    Lambda-->>Lambda: Call your function
    Lambda->>Persistence Layer: Update record with result
    deactivate Persistence Layer
    Persistence Layer-->>Persistence Layer: Update record
    Note over Lambda,Persistence Layer: Set record status to COMPLETE. <br> New invocations with the same payload <br> now return the same result
    Lambda-->>Client: Response sent to client
```
<i>Concurrent identical in-flight requests</i>
</center>

#### Lambda request timeout

<center>
```mermaid
sequenceDiagram
    participant Client
    participant Lambda
    participant Persistence Layer
    alt initial request
        Client->>Lambda: Invoke (event)
        Lambda->>Persistence Layer: Get or set idempotency_key=hash(payload)
        activate Persistence Layer
        Note over Lambda,Persistence Layer: Set record status to INPROGRESS. <br> Prevents concurrent invocations <br> with the same payload
        Lambda-->>Lambda: Call your function
        Note right of Lambda: Time out
        Lambda--xLambda: Time out error
        Lambda-->>Client: Return error response
        deactivate Persistence Layer
    else retry after Lambda timeout elapses
        Client->>Lambda: Invoke (event)
        Lambda->>Persistence Layer: Get or set idempotency_key=hash(payload)
        activate Persistence Layer
        Note over Lambda,Persistence Layer: Set record status to INPROGRESS. <br> Reset in_progress_expiry attribute
        Lambda-->>Lambda: Call your function
        Lambda->>Persistence Layer: Update record with result
        deactivate Persistence Layer
        Persistence Layer-->>Persistence Layer: Update record
        Lambda-->>Client: Response sent to client
    end
```
<i>Idempotent request during and after Lambda timeouts</i>
</center>

#### Optional idempotency key

<center>
```mermaid
sequenceDiagram
    participant Client
    participant Lambda
    participant Persistence Layer
    alt request with idempotency key
        Client->>Lambda: Invoke (event)
        Lambda->>Persistence Layer: Get or set idempotency_key=hash(payload)
        activate Persistence Layer
        Note over Lambda,Persistence Layer: Set record status to INPROGRESS. <br> Prevents concurrent invocations <br> with the same payload
        Lambda-->>Lambda: Call your function
        Lambda->>Persistence Layer: Update record with result
        deactivate Persistence Layer
        Persistence Layer-->>Persistence Layer: Update record
        Note over Lambda,Persistence Layer: Set record status to COMPLETE. <br> New invocations with the same payload <br> now return the same result
        Lambda-->>Client: Response sent to client
    else request(s) without idempotency key
        Client->>Lambda: Invoke (event)
        Note over Lambda: Idempotency key is missing
        Note over Persistence Layer: Skips any operation to fetch, update, and delete
        Lambda-->>Lambda: Call your function
        Lambda-->>Client: Response sent to client
    end
```
<i>Optional idempotency key</i>
</center>

## Advanced

### Persistence layers

#### DynamoDBPersistenceLayer

This persistence layer is built-in, and you can either use an existing DynamoDB table or create a new one dedicated for idempotency state (recommended).

=== "Customizing DynamoDBPersistenceLayer to suit your table structure"

    ```typescript hl_lines="7-15"
    --8<-- "docs/snippets/idempotency/customizePersistenceLayer.ts"
    ```

When using DynamoDB as a persistence layer, you can alter the attribute names by passing these parameters when initializing the persistence layer:

| Parameter                | Required           | Default                              | Description                                                                                              |
| ------------------------ | ------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **tableName**            | :heavy_check_mark: |                                      | Table name to store state                                                                                |
| **keyAttr**              |                    | `id`                                 | Partition key of the table. Hashed representation of the payload (unless **sort_key_attr** is specified) |
| **expiryAttr**           |                    | `expiration`                         | Unix timestamp of when record expires                                                                    |
| **inProgressExpiryAttr** |                    | `in_progress_expiration`             | Unix timestamp of when record expires while in progress (in case of the invocation times out)            |
| **statusAttr**           |                    | `status`                             | Stores status of the lambda execution during and after invocation                                        |
| **dataAttr**             |                    | `data`                               | Stores results of successfully executed Lambda handlers                                                  |
| **validationKeyAttr**    |                    | `validation`                         | Hashed representation of the parts of the event used for validation                                      |
| **sortKeyAttr**          |                    |                                      | Sort key of the table (if table is configured with a sort key).                                          |
| **staticPkValue**        |                    | `idempotency#{LAMBDA_FUNCTION_NAME}` | Static value to use as the partition key. Only used when **sort_key_attr** is set.                       |

### Customizing the default behavior

Idempotent decorator can be further configured with **`IdempotencyConfig`** as seen in the previous examples. These are the available options for further configuration

| Parameter                     | Default | Description                                                                                                                                                                                |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **eventKeyJmespath**          | `''`    | JMESPath expression to extract the idempotency key from the event                                                                                                                          |
| **payloadValidationJmespath** | `''`    | JMESPath expression to validate whether certain parameters have changed in the event while the event payload                                                                               |
| **throwOnNoIdempotencyKey**   | `false` | Throw an error if no idempotency key was found in the request                                                                                                                              |
| **expiresAfterSeconds**       | 3600    | The number of seconds to wait before a record is expired                                                                                                                                   |
| **useLocalCache**             | `false` | Whether to locally cache idempotency results                                                                                                                                               |
| **localCacheMaxItems**        | 256     | Max number of items to store in local cache                                                                                                                                                |
| **hashFunction**              | `md5`   | Function to use for calculating hashes, as provided by the [crypto](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options){target="_blank"} module in the standard library. |

### Handling concurrent executions with the same payload

This utility will throw an **`IdempotencyAlreadyInProgressError`** error if you receive **multiple invocations with the same payload while the first invocation hasn't completed yet**.

???+ info
    If you receive `IdempotencyAlreadyInProgressError`, you can safely retry the operation.

This is a locking mechanism for correctness. Since we don't know the result from the first invocation yet, we can't safely allow another concurrent execution.

### Using in-memory cache

**By default, in-memory local caching is disabled**, since we don't know how much memory you consume per invocation compared to the maximum configured in your Lambda function.

???+ note "Note: This in-memory cache is local to each Lambda execution environment"
    This means it will be effective in cases where your function's concurrency is low in comparison to the number of "retry" invocations with the same payload, because cache might be empty.

You can enable in-memory caching with the **`useLocalCache`** parameter:

=== "Caching idempotent transactions in-memory to prevent multiple calls to storage"

    ```typescript hl_lines="12-13"
    --8<-- "docs/snippets/idempotency/workingWithLocalCache.ts"
    ```

When enabled, the default is to cache a maximum of 256 records in each Lambda execution environment - You can change it with the **`maxLocalCacheSize`** parameter.

### Expiring idempotency records

!!! note "By default, we expire idempotency records after **an hour** (3600 seconds)."

In most cases, it is not desirable to store the idempotency records forever. Rather, you want to guarantee that the same payload won't be executed within a period of time.

You can change this window with the **`expiresAfterSeconds`** parameter:

=== "Adjusting idempotency record expiration"

    ```typescript hl_lines="14"
    --8<-- "docs/snippets/idempotency/workingWithRecordExpiration.ts"
    ```

This will mark any records older than 5 minutes as expired, and [your function will be executed as normal if it is invoked with a matching payload](#expired-idempotency-records).

???+ important "Idempotency record expiration vs DynamoDB time-to-live (TTL)"
    [DynamoDB TTL is a feature](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/howitworks-ttl.html){target="_blank"} to remove items after a certain period of time, it may occur within 48 hours of expiration.

    We don't rely on DynamoDB or any persistence storage layer to determine whether a record is expired to avoid eventual inconsistency states.

    Instead, Idempotency records saved in the storage layer contain timestamps that can be verified upon retrieval and double checked within Idempotency feature.

    **Why?**

    A record might still be valid (`COMPLETE`) when we retrieved, but in some rare cases it might expire a second later. A record could also be [cached in memory](#using-in-memory-cache). You might also want to have idempotent transactions that should expire in seconds.

### Payload validation

???+ question "Question: What if your function is invoked with the same payload except some outer parameters have changed?"
    Example: A payment transaction for a given productID was requested twice for the same customer, **however the amount to be paid has changed in the second transaction**.

By default, we will return the same result as it returned before, however in this instance it may be misleading; we provide a fail fast payload validation to address this edge case.

With **`payloadValidationJmesPath`**, you can provide an additional JMESPath expression to specify which part of the event body should be validated against previous idempotent invocations

=== "Payload validation"

    ```typescript hl_lines="14-15"
    --8<-- "docs/snippets/idempotency/workingWithPayloadValidation.ts"
    ```

In this example, the **`userId`** and **`productId`** keys are used as the payload to generate the idempotency key, as per **`eventKeyJmespath`** parameter.

???+ note
    If we try to send the same request but with a different amount, we will raise **`IdempotencyValidationError`**.

Without payload validation, we would have returned the same result as we did for the initial request. Since we're also returning an amount in the response, this could be quite confusing for the client.

By using **`payloadValidationJmesPath="amount"`**, we prevent this potentially confusing behavior and instead throw an error.

### Making idempotency key required

If you want to enforce that an idempotency key is required, you can set **`throwOnNoIdempotencyKey`** to `true`.

This means that we will raise **`IdempotencyKeyError`** if the evaluation of **`eventKeyJmesPath`** results in an empty subset.

???+ warning
    To prevent errors, transactions will not be treated as idempotent if **`throwOnNoIdempotencyKey`** is set to `false` and the evaluation of **`eventKeyJmesPath`** is an empty result. Therefore, no data will be fetched, stored, or deleted in the idempotency storage layer.

=== "Idempotency key required"

    ```typescript hl_lines="14-15"
    --8<-- "docs/snippets/idempotency/workingWithIdempotencyRequiredKey.ts"
    ```

=== "Success Event"

    ```json hl_lines="3 6"
    {
        "user": {
            "uid": "BB0D045C-8878-40C8-889E-38B3CB0A61B1",
            "name": "Foo"
        },
        "productId": 10000
    }
    ```

=== "Failure Event"

    ```json hl_lines="3 5"
    {
        "user": {
            "uid": "BB0D045C-8878-40C8-889E-38B3CB0A61B1",
            "name": "foo",
            "productId": 10000
        }
    }
    ```

### Customizing AWS SDK configuration

The **`clientConfig`** and **`awsSdkV3Client`** parameters enable you to pass in custom configurations or your own [DynamoDBClient](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/dynamodb/){target="_blank"} when constructing the persistence store.

=== "Passing specific configuration"

    ```typescript hl_lines="8-10"
    --8<-- "docs/snippets/idempotency/workingWithCustomConfig.ts"
    ```

=== "Passing custom DynamoDBClient"

    ```typescript hl_lines="7-9 12"
    --8<-- "docs/snippets/idempotency/workingWithCustomClient.ts"
    ```

### Using a DynamoDB table with a composite primary key

When using a composite primary key table (hash+range key), use `sortKeyAttr` parameter when initializing your persistence layer.

With this setting, we will save the idempotency key in the sort key instead of the primary key. By default, the primary key will now be set to `idempotency#{LAMBDA_FUNCTION_NAME}`.

You can optionally set a static value for the partition key using the `staticPkValue` parameter.

=== "Reusing a DynamoDB table that uses a composite primary key"

    ```typescript hl_lines="9"
    --8<-- "docs/snippets/idempotency/workingWithCompositeKey.ts"
    ```

The example function above would cause data to be stored in DynamoDB like this:

| id                           | sort_key                         | expiration | status      | data                                                             |
| ---------------------------- | -------------------------------- | ---------- | ----------- | ---------------------------------------------------------------- |
| idempotency#MyLambdaFunction | 1e956ef7da78d0cb890be999aecc0c9e | 1636549553 | COMPLETED   | {"paymentId": "12345, "message": "success", "statusCode": 200}   |
| idempotency#MyLambdaFunction | 2b2cdb5f86361e97b4383087c1ffdf27 | 1636549571 | COMPLETED   | {"paymentId": "527212", "message": "success", "statusCode": 200} |
| idempotency#MyLambdaFunction | f091d2527ad1c78f05d54cc3f363be80 | 1636549585 | IN_PROGRESS |                                                                  |

## Extra resources

If you're interested in a deep dive on how Amazon uses idempotency when building our APIs, check out
[this article](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/){target="_blank"}.