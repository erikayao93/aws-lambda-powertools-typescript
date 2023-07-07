/**
 * Test BatchProcessor class
 *
 * @group unit/batch/class/batchprocessor
 */
import { BatchProcessingError, BatchProcessor, EventType } from '../../src';
import { DynamoDBRecord, KinesisStreamRecord, SQSRecord } from 'aws-lambda';
import {
  sqsEventFactory,
  kinesisEventFactory,
  dynamodbEventFactory,
} from '../../tests/helpers/factories';
import {
  sqsRecordHandler,
  asyncSqsRecordHandler,
  kinesisRecordHandler,
  asyncKinesisRecordHandler,
  dynamodbRecordHandler,
  asyncDynamodbRecordHandler,
} from '../../tests/helpers/handlers';

describe('Class: BatchProcessor', () => {
  const ENVIRONMENT_VARIABLES = process.env;

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
      const firstRecord = sqsEventFactory('success');
      const secondRecord = sqsEventFactory('success');
      const records = [firstRecord, secondRecord];
      const processor = new BatchProcessor(EventType.SQS);

      // Act
      processor.register(records, sqsRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages).toStrictEqual([
        ['success', (firstRecord as SQSRecord).body, firstRecord],
        ['success', (secondRecord as SQSRecord).body, secondRecord],
      ]);
    });

    test('Batch processing SQS records with some failures', async () => {
      // Prepare
      const firstRecord = sqsEventFactory('failure');
      const secondRecord = sqsEventFactory('success');
      const thirdRecord = sqsEventFactory('fail');
      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.SQS);

      // Act
      processor.register(records, sqsRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages[1]).toStrictEqual([
        'success',
        (secondRecord as SQSRecord).body,
        secondRecord,
      ]);
      expect(processor.failureMessages.length).toBe(2);
      expect(processor.response()).toStrictEqual({
        batchItemFailures: [
          { itemIdentifier: (firstRecord as SQSRecord).messageId },
          { itemIdentifier: (thirdRecord as SQSRecord).messageId },
        ],
      });
    });

    test('Batch processing SQS records with all failures', async () => {
      // Prepare
      const firstRecord = sqsEventFactory('failure');
      const secondRecord = sqsEventFactory('failure');
      const thirdRecord = sqsEventFactory('fail');

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
      const firstRecord = sqsEventFactory('success');
      const secondRecord = sqsEventFactory('success');
      const records = [firstRecord, secondRecord];
      const processor = new BatchProcessor(EventType.SQS);

      // Act
      processor.register(records, asyncSqsRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages).toStrictEqual([
        ['success', (firstRecord as SQSRecord).body, firstRecord],
        ['success', (secondRecord as SQSRecord).body, secondRecord],
      ]);
    });

    test('Batch processing SQS records with failures', async () => {
      // Prepare
      const firstRecord = sqsEventFactory('failure');
      const secondRecord = sqsEventFactory('success');
      const thirdRecord = sqsEventFactory('fail');
      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.SQS);

      // Act
      processor.register(records, asyncSqsRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages[1]).toStrictEqual([
        'success',
        (secondRecord as SQSRecord).body,
        secondRecord,
      ]);
      expect(processor.failureMessages.length).toBe(2);
      expect(processor.response()).toStrictEqual({
        batchItemFailures: [
          { itemIdentifier: (firstRecord as SQSRecord).messageId },
          { itemIdentifier: (thirdRecord as SQSRecord).messageId },
        ],
      });
    });

    test('Batch processing SQS records with all failures', async () => {
      // Prepare
      const firstRecord = sqsEventFactory('failure');
      const secondRecord = sqsEventFactory('failure');
      const thirdRecord = sqsEventFactory('fail');

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
      const firstRecord = kinesisEventFactory('success');
      const secondRecord = kinesisEventFactory('success');
      const records = [firstRecord, secondRecord];
      const processor = new BatchProcessor(EventType.KinesisDataStreams);

      // Act
      processor.register(records, kinesisRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages).toStrictEqual([
        [
          'success',
          (firstRecord as KinesisStreamRecord).kinesis.data,
          firstRecord,
        ],
        [
          'success',
          (secondRecord as KinesisStreamRecord).kinesis.data,
          secondRecord,
        ],
      ]);
    });

    test('Batch processing Kinesis records with failures', async () => {
      // Prepare
      const firstRecord = kinesisEventFactory('failure');
      const secondRecord = kinesisEventFactory('success');
      const thirdRecord = kinesisEventFactory('fail');
      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.KinesisDataStreams);

      // Act
      processor.register(records, kinesisRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages[1]).toStrictEqual([
        'success',
        (secondRecord as KinesisStreamRecord).kinesis.data,
        secondRecord,
      ]);
      expect(processor.failureMessages.length).toBe(2);
      expect(processor.response()).toStrictEqual({
        batchItemFailures: [
          {
            itemIdentifier: (firstRecord as KinesisStreamRecord).kinesis
              .sequenceNumber,
          },
          {
            itemIdentifier: (thirdRecord as KinesisStreamRecord).kinesis
              .sequenceNumber,
          },
        ],
      });
    });

    test('Batch processing Kinesis records with all failures', async () => {
      const firstRecord = kinesisEventFactory('failure');
      const secondRecord = kinesisEventFactory('failure');
      const thirdRecord = kinesisEventFactory('fail');

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
      const firstRecord = kinesisEventFactory('success');
      const secondRecord = kinesisEventFactory('success');
      const records = [firstRecord, secondRecord];
      const processor = new BatchProcessor(EventType.KinesisDataStreams);

      // Act
      processor.register(records, asyncKinesisRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages).toStrictEqual([
        [
          'success',
          (firstRecord as KinesisStreamRecord).kinesis.data,
          firstRecord,
        ],
        [
          'success',
          (secondRecord as KinesisStreamRecord).kinesis.data,
          secondRecord,
        ],
      ]);
    });

    test('Batch processing Kinesis records with failures', async () => {
      // Prepare
      const firstRecord = kinesisEventFactory('failure');
      const secondRecord = kinesisEventFactory('success');
      const thirdRecord = kinesisEventFactory('fail');
      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.KinesisDataStreams);

      // Act
      processor.register(records, asyncKinesisRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages[1]).toStrictEqual([
        'success',
        (secondRecord as KinesisStreamRecord).kinesis.data,
        secondRecord,
      ]);
      expect(processor.failureMessages.length).toBe(2);
      expect(processor.response()).toStrictEqual({
        batchItemFailures: [
          {
            itemIdentifier: (firstRecord as KinesisStreamRecord).kinesis
              .sequenceNumber,
          },
          {
            itemIdentifier: (thirdRecord as KinesisStreamRecord).kinesis
              .sequenceNumber,
          },
        ],
      });
    });

    test('Batch processing Kinesis records with all failures', async () => {
      // Prepare
      const firstRecord = kinesisEventFactory('failure');
      const secondRecord = kinesisEventFactory('failure');
      const thirdRecord = kinesisEventFactory('fail');

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
      const firstRecord = dynamodbEventFactory('success');
      const secondRecord = dynamodbEventFactory('success');
      const records = [firstRecord, secondRecord];
      const processor = new BatchProcessor(EventType.DynamoDBStreams);

      // Act
      processor.register(records, dynamodbRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages).toStrictEqual([
        [
          'success',
          (firstRecord as DynamoDBRecord).dynamodb?.NewImage?.Message,
          firstRecord,
        ],
        [
          'success',
          (secondRecord as DynamoDBRecord).dynamodb?.NewImage?.Message,
          secondRecord,
        ],
      ]);
    });

    test('Batch processing DynamoDB records with failures', async () => {
      // Prepare
      const firstRecord = dynamodbEventFactory('failure');
      const secondRecord = dynamodbEventFactory('success');
      const thirdRecord = dynamodbEventFactory('fail');
      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.DynamoDBStreams);

      // Act
      processor.register(records, dynamodbRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages[1]).toStrictEqual([
        'success',
        (secondRecord as DynamoDBRecord).dynamodb?.NewImage?.Message,
        secondRecord,
      ]);
      expect(processor.failureMessages.length).toBe(2);
      expect(processor.response()).toStrictEqual({
        batchItemFailures: [
          {
            itemIdentifier: (firstRecord as DynamoDBRecord).dynamodb
              ?.SequenceNumber,
          },
          {
            itemIdentifier: (thirdRecord as DynamoDBRecord).dynamodb
              ?.SequenceNumber,
          },
        ],
      });
    });

    test('Batch processing DynamoDB records with all failures', async () => {
      // Prepare
      const firstRecord = dynamodbEventFactory('failure');
      const secondRecord = dynamodbEventFactory('failure');
      const thirdRecord = dynamodbEventFactory('fail');

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
      const firstRecord = dynamodbEventFactory('success');
      const secondRecord = dynamodbEventFactory('success');
      const records = [firstRecord, secondRecord];
      const processor = new BatchProcessor(EventType.DynamoDBStreams);

      // Act
      processor.register(records, asyncDynamodbRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages).toStrictEqual([
        [
          'success',
          (firstRecord as DynamoDBRecord).dynamodb?.NewImage?.Message,
          firstRecord,
        ],
        [
          'success',
          (secondRecord as DynamoDBRecord).dynamodb?.NewImage?.Message,
          secondRecord,
        ],
      ]);
    });

    test('Batch processing DynamoDB records with failures', async () => {
      // Prepare
      const firstRecord = dynamodbEventFactory('failure');
      const secondRecord = dynamodbEventFactory('success');
      const thirdRecord = dynamodbEventFactory('fail');
      const records = [firstRecord, secondRecord, thirdRecord];
      const processor = new BatchProcessor(EventType.DynamoDBStreams);

      // Act
      processor.register(records, asyncDynamodbRecordHandler);
      const processedMessages = await processor.process();

      // Assess
      expect(processedMessages[1]).toStrictEqual([
        'success',
        (secondRecord as DynamoDBRecord).dynamodb?.NewImage?.Message,
        secondRecord,
      ]);
      expect(processor.failureMessages.length).toBe(2);
      expect(processor.response()).toStrictEqual({
        batchItemFailures: [
          {
            itemIdentifier: (firstRecord as DynamoDBRecord).dynamodb
              ?.SequenceNumber,
          },
          {
            itemIdentifier: (thirdRecord as DynamoDBRecord).dynamodb
              ?.SequenceNumber,
          },
        ],
      });
    });

    test('Batch processing DynamoDB records with all failures', async () => {
      // Prepare
      const firstRecord = dynamodbEventFactory('failure');
      const secondRecord = dynamodbEventFactory('failure');
      const thirdRecord = dynamodbEventFactory('fail');

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
});
