/**
 * Test BatchProcessor class
 *
 * @group unit/batch/class/batchprocessor
 */

import {
  BatchProcessingError,
  BatchProcessingOptions,
  BatchProcessor,
  EventType,
} from '../../src';
import {
  sqsRecordFactory,
  kinesisRecordFactory,
  dynamodbRecordFactory,
} from '../../tests/helpers/factories';
import {
  sqsRecordHandler,
  asyncSqsRecordHandler,
  kinesisRecordHandler,
  asyncKinesisRecordHandler,
  dynamodbRecordHandler,
  asyncDynamodbRecordHandler,
  handlerWithContext,
} from '../../tests/helpers/handlers';
import { helloworldContext as dummyContext } from '../../../commons/src/samples/resources/contexts';

describe('Class: BatchProcessor', () => {
  const ENVIRONMENT_VARIABLES = process.env;
  const options: BatchProcessingOptions = { context: dummyContext };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env = { ...ENVIRONMENT_VARIABLES };
  });

  afterAll(() => {
    process.env = ENVIRONMENT_VARIABLES;
  });

  describe('Synchronously processing SQS Records', () => {
    test('Batch processing SQS records with no failures', async () => {
      // Prepare
      const firstRecord = sqsRecordFactory('success');
      const secondRecord = sqsRecordFactory('success');
      const records = [firstRecord, secondRecord];
      const processor = new BatchProcessor(EventType.SQS);

      // Act
      processor.register(records, sqsRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages).toStrictEqual([
        ['success', firstRecord.body, firstRecord],
        ['success', secondRecord.body, secondRecord],
      ]);
    });

    test('Batch processing SQS records with some failures', async () => {
      // Prepare
      const firstRecord = sqsRecordFactory('failure');
      const secondRecord = sqsRecordFactory('success');
      const thirdRecord = sqsRecordFactory('fail');
      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.SQS);

      // Act
      processor.register(records, sqsRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages[1]).toStrictEqual([
        'success',
        secondRecord.body,
        secondRecord,
      ]);
      expect(processor.failureMessages.length).toBe(2);
      expect(processor.response()).toStrictEqual({
        batchItemFailures: [
          { itemIdentifier: firstRecord.messageId },
          { itemIdentifier: thirdRecord.messageId },
        ],
      });
    });

    test('Batch processing SQS records with all failures', async () => {
      // Prepare
      const firstRecord = sqsRecordFactory('failure');
      const secondRecord = sqsRecordFactory('failure');
      const thirdRecord = sqsRecordFactory('fail');

      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.SQS);

      // Act & Assess
      processor.register(records, sqsRecordHandler);
      await expect(processor.process()).rejects.toThrowError(
        BatchProcessingError
      );
    });
  });

  describe('Asynchronously processing SQS Records', () => {
    test('Batch processing SQS records with no failures', async () => {
      // Prepare
      const firstRecord = sqsRecordFactory('success');
      const secondRecord = sqsRecordFactory('success');
      const records = [firstRecord, secondRecord];
      const processor = new BatchProcessor(EventType.SQS);

      // Act
      processor.register(records, asyncSqsRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages).toStrictEqual([
        ['success', firstRecord.body, firstRecord],
        ['success', secondRecord.body, secondRecord],
      ]);
    });

    test('Batch processing SQS records with some failures', async () => {
      // Prepare
      const firstRecord = sqsRecordFactory('failure');
      const secondRecord = sqsRecordFactory('success');
      const thirdRecord = sqsRecordFactory('fail');
      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.SQS);

      // Act
      processor.register(records, asyncSqsRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages[1]).toStrictEqual([
        'success',
        secondRecord.body,
        secondRecord,
      ]);
      expect(processor.failureMessages.length).toBe(2);
      expect(processor.response()).toStrictEqual({
        batchItemFailures: [
          { itemIdentifier: firstRecord.messageId },
          { itemIdentifier: thirdRecord.messageId },
        ],
      });
    });

    test('Batch processing SQS records with all failures', async () => {
      // Prepare
      const firstRecord = sqsRecordFactory('failure');
      const secondRecord = sqsRecordFactory('failure');
      const thirdRecord = sqsRecordFactory('fail');

      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.SQS);

      // Act
      processor.register(records, asyncSqsRecordHandler);

      // Assess
      await expect(processor.process()).rejects.toThrowError(
        BatchProcessingError
      );
    });
  });

  describe('Synchronously processing Kinesis Records', () => {
    test('Batch processing Kinesis records with no failures', async () => {
      // Prepare
      const firstRecord = kinesisRecordFactory('success');
      const secondRecord = kinesisRecordFactory('success');
      const records = [firstRecord, secondRecord];
      const processor = new BatchProcessor(EventType.KinesisDataStreams);

      // Act
      processor.register(records, kinesisRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages).toStrictEqual([
        ['success', firstRecord.kinesis.data, firstRecord],
        ['success', secondRecord.kinesis.data, secondRecord],
      ]);
    });

    test('Batch processing Kinesis records with some failures', async () => {
      // Prepare
      const firstRecord = kinesisRecordFactory('failure');
      const secondRecord = kinesisRecordFactory('success');
      const thirdRecord = kinesisRecordFactory('fail');
      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.KinesisDataStreams);

      // Act
      processor.register(records, kinesisRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages[1]).toStrictEqual([
        'success',
        secondRecord.kinesis.data,
        secondRecord,
      ]);
      expect(processor.failureMessages.length).toBe(2);
      expect(processor.response()).toStrictEqual({
        batchItemFailures: [
          { itemIdentifier: firstRecord.kinesis.sequenceNumber },
          { itemIdentifier: thirdRecord.kinesis.sequenceNumber },
        ],
      });
    });

    test('Batch processing Kinesis records with all failures', async () => {
      const firstRecord = kinesisRecordFactory('failure');
      const secondRecord = kinesisRecordFactory('failure');
      const thirdRecord = kinesisRecordFactory('fail');

      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.KinesisDataStreams);

      // Act
      processor.register(records, kinesisRecordHandler);

      // Assess
      await expect(processor.process()).rejects.toThrowError(
        BatchProcessingError
      );
    });
  });

  describe('Asynchronously processing Kinesis Records', () => {
    test('Batch processing Kinesis records with no failures', async () => {
      // Prepare
      const firstRecord = kinesisRecordFactory('success');
      const secondRecord = kinesisRecordFactory('success');
      const records = [firstRecord, secondRecord];
      const processor = new BatchProcessor(EventType.KinesisDataStreams);

      // Act
      processor.register(records, asyncKinesisRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages).toStrictEqual([
        ['success', firstRecord.kinesis.data, firstRecord],
        ['success', secondRecord.kinesis.data, secondRecord],
      ]);
    });

    test('Batch processing Kinesis records with some failures', async () => {
      // Prepare
      const firstRecord = kinesisRecordFactory('failure');
      const secondRecord = kinesisRecordFactory('success');
      const thirdRecord = kinesisRecordFactory('fail');
      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.KinesisDataStreams);

      // Act
      processor.register(records, asyncKinesisRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages[1]).toStrictEqual([
        'success',
        secondRecord.kinesis.data,
        secondRecord,
      ]);
      expect(processor.failureMessages.length).toBe(2);
      expect(processor.response()).toStrictEqual({
        batchItemFailures: [
          { itemIdentifier: firstRecord.kinesis.sequenceNumber },
          { itemIdentifier: thirdRecord.kinesis.sequenceNumber },
        ],
      });
    });

    test('Batch processing Kinesis records with all failures', async () => {
      // Prepare
      const firstRecord = kinesisRecordFactory('failure');
      const secondRecord = kinesisRecordFactory('failure');
      const thirdRecord = kinesisRecordFactory('fail');

      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.KinesisDataStreams);

      // Act
      processor.register(records, asyncKinesisRecordHandler);

      // Assess
      await expect(processor.process()).rejects.toThrowError(
        BatchProcessingError
      );
    });
  });

  describe('Synchronously processing DynamoDB Records', () => {
    test('Batch processing DynamoDB records with no failures', async () => {
      // Prepare
      const firstRecord = dynamodbRecordFactory('success');
      const secondRecord = dynamodbRecordFactory('success');
      const records = [firstRecord, secondRecord];
      const processor = new BatchProcessor(EventType.DynamoDBStreams);

      // Act
      processor.register(records, dynamodbRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages).toStrictEqual([
        ['success', firstRecord.dynamodb?.NewImage?.Message, firstRecord],
        ['success', secondRecord.dynamodb?.NewImage?.Message, secondRecord],
      ]);
    });

    test('Batch processing DynamoDB records with some failures', async () => {
      // Prepare
      const firstRecord = dynamodbRecordFactory('failure');
      const secondRecord = dynamodbRecordFactory('success');
      const thirdRecord = dynamodbRecordFactory('fail');
      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.DynamoDBStreams);

      // Act
      processor.register(records, dynamodbRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages[1]).toStrictEqual([
        'success',
        secondRecord.dynamodb?.NewImage?.Message,
        secondRecord,
      ]);
      expect(processor.failureMessages.length).toBe(2);
      expect(processor.response()).toStrictEqual({
        batchItemFailures: [
          { itemIdentifier: firstRecord.dynamodb?.SequenceNumber },
          { itemIdentifier: thirdRecord.dynamodb?.SequenceNumber },
        ],
      });
    });

    test('Batch processing DynamoDB records with all failures', async () => {
      // Prepare
      const firstRecord = dynamodbRecordFactory('failure');
      const secondRecord = dynamodbRecordFactory('failure');
      const thirdRecord = dynamodbRecordFactory('fail');

      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.DynamoDBStreams);

      // Act
      processor.register(records, dynamodbRecordHandler);

      // Assess
      await expect(processor.process()).rejects.toThrowError(
        BatchProcessingError
      );
    });
  });

  describe('Asynchronously processing DynamoDB Records', () => {
    test('Batch processing DynamoDB records with no failures', async () => {
      // Prepare
      const firstRecord = dynamodbRecordFactory('success');
      const secondRecord = dynamodbRecordFactory('success');
      const records = [firstRecord, secondRecord];
      const processor = new BatchProcessor(EventType.DynamoDBStreams);

      // Act
      processor.register(records, asyncDynamodbRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages).toStrictEqual([
        ['success', firstRecord.dynamodb?.NewImage?.Message, firstRecord],
        ['success', secondRecord.dynamodb?.NewImage?.Message, secondRecord],
      ]);
    });

    test('Batch processing DynamoDB records with some failures', async () => {
      // Prepare
      const firstRecord = dynamodbRecordFactory('failure');
      const secondRecord = dynamodbRecordFactory('success');
      const thirdRecord = dynamodbRecordFactory('fail');
      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.DynamoDBStreams);

      // Act
      processor.register(records, asyncDynamodbRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages[1]).toStrictEqual([
        'success',
        secondRecord.dynamodb?.NewImage?.Message,
        secondRecord,
      ]);
      expect(processor.failureMessages.length).toBe(2);
      expect(processor.response()).toStrictEqual({
        batchItemFailures: [
          { itemIdentifier: firstRecord.dynamodb?.SequenceNumber },
          { itemIdentifier: thirdRecord.dynamodb?.SequenceNumber },
        ],
      });
    });

    test('Batch processing DynamoDB records with all failures', async () => {
      // Prepare
      const firstRecord = dynamodbRecordFactory('failure');
      const secondRecord = dynamodbRecordFactory('failure');
      const thirdRecord = dynamodbRecordFactory('fail');

      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.DynamoDBStreams);

      // Act
      processor.register(records, asyncDynamodbRecordHandler);

      // Assess
      await expect(processor.process()).rejects.toThrowError(
        BatchProcessingError
      );
    });
  });

  describe('Batch processing with Lambda context', () => {
    test('Batch processing when context is provided and handler accepts', async () => {
      // Prepare
      const firstRecord = sqsRecordFactory('success');
      const secondRecord = sqsRecordFactory('success');
      const records = [firstRecord, secondRecord];
      const processor = new BatchProcessor(EventType.SQS);

      // Act
      processor.register(records, handlerWithContext, options);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages).toStrictEqual([
        ['success', firstRecord.body, firstRecord],
        ['success', secondRecord.body, secondRecord],
      ]);
    });

    test('Batch processing when context is provided and handler does not accept', async () => {
      // Prepare
      const firstRecord = sqsRecordFactory('success');
      const secondRecord = sqsRecordFactory('success');
      const records = [firstRecord, secondRecord];
      const processor = new BatchProcessor(EventType.SQS);

      // Act
      processor.register(records, sqsRecordHandler, options);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages).toStrictEqual([
        ['success', firstRecord.body, firstRecord],
        ['success', secondRecord.body, secondRecord],
      ]);
    });
  });
});
