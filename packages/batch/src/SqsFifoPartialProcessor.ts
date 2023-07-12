import { BatchProcessor, EventType, FailureResponse, SuccessResponse } from '.';

/**
 * Process native partial responses from SQS FIFO queues
 * Stops processing records when the first record fails
 * The remaining records are reported as failed items
 */
class SqsFifoPartialProcessor extends BatchProcessor {
  public constructor() {
    super(EventType.SQS);
  }

  /**
   * Call instance's handler for each record.
   * When the first failed message is detected, the process is short-circuited
   * And the remaining messages are reported as failed items
   * TODO: change to synchronous execution if possible
   */
  public async process(): Promise<(SuccessResponse | FailureResponse)[]> {
    this.prepare();

    const processedRecords: (SuccessResponse | FailureResponse)[] = [];
    let currentIndex = 0;
    for (const record of this.records) {
      // If we have any failed messages, it means the last message failed
      // We should then short circuit the process and fail remaining messages
      if (this.failureMessages) {
        return this.shortCircuitProcessing(currentIndex, processedRecords);
      }

      processedRecords.push(await this.processRecord(record));
      currentIndex++;
    }

    this.clean();

    return processedRecords;
  }

  /**
   * Starting from the first failure index, fail all remaining messages and append them to the result list
   * @param firstFailureIndex Index of first message that failed
   * @param result List of success and failure responses with remaining messages failed
   */
  public shortCircuitProcessing(
    firstFailureIndex: number,
    processedRecords: (SuccessResponse | FailureResponse)[]
  ): (SuccessResponse | FailureResponse)[] {
    const remainingRecords = this.records.slice(firstFailureIndex);

    for (const record of remainingRecords) {
      const data = this.toBatchType(record, this.eventType);
      processedRecords.push(
        this.failureHandler(
          data,
          new Error('A previous record failed processing')
        )
      );
    }

    this.clean();

    return processedRecords;
  }
}

export { SqsFifoPartialProcessor };
