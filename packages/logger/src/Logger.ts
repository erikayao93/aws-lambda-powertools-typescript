import { randomInt } from 'node:crypto';
import { Console } from 'node:console';
import type { Context, Handler } from 'aws-lambda';
import { Utility } from '@aws-lambda-powertools/commons';
import { LogFormatterInterface, PowertoolLogFormatter } from './formatter';
import { LogItem } from './log';
import merge from 'lodash.merge';
import { ConfigServiceInterface, EnvironmentVariablesService } from './config';
import { LogJsonIndent } from './types';
import type {
  ClassThatLogs,
  Environment,
  HandlerMethodDecorator,
  LambdaFunctionContext,
  LogAttributes,
  ConstructorOptions,
  LogItemExtraInput,
  LogItemMessage,
  LogLevel,
  LogLevelThresholds,
  PowertoolLogData,
  HandlerOptions,
} from './types';

/**
 * ## Intro
 * The Logger utility provides an opinionated logger with output structured as JSON.
 *
 * ## Key features
 *  * Capture key fields from Lambda context, cold start and structures logging output as JSON
 *  * Log Lambda context when instructed (disabled by default)
 *  * Log sampling prints all logs for a percentage of invocations (disabled by default)
 *  * Append additional keys to structured log at any point in time
 *
 * ## Usage
 *
 * For more usage examples, see [our documentation](https://docs.powertools.aws.dev/lambda-typescript/latest/core/logger/).
 *
 * ### Basic usage
 *
 * @example
 * ```typescript
 * import { Logger } from '@aws-lambda-powertools/logger';
 *
 * // Logger parameters fetched from the environment variables:
 * const logger = new Logger();
 * ```
 *
 * ### Functions usage with middleware
 *
 * If you use function-based Lambda handlers you can use the [injectLambdaContext()](#injectLambdaContext)
 * middy middleware to automatically add context to your Lambda logs.
 *
 * @example
 * ```typescript
 * import { Logger, injectLambdaContext } from '@aws-lambda-powertools/logger';
 * import middy from '@middy/core';
 *
 * const logger = new Logger();
 *
 * const lambdaHandler = async (_event: any, _context: any) => {
 *     logger.info('This is an INFO log with some context');
 * };
 *
 * export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
 * ```
 *
 * ### Object oriented usage with decorators
 *
 * If instead you use TypeScript classes to wrap your Lambda handler you can use the [@logger.injectLambdaContext()](./_aws_lambda_powertools_logger.Logger.html#injectLambdaContext) decorator.
 *
 * @example
 * ```typescript
 * import { Logger } from '@aws-lambda-powertools/logger';
 * import { LambdaInterface } from '@aws-lambda-powertools/commons';
 *
 * const logger = new Logger();
 *
 * class Lambda implements LambdaInterface {
 *
 *   // FYI: Decorator might not render properly in VSCode mouse over due to https://github.com/microsoft/TypeScript/issues/47679 and might show as *@logger* instead of `@logger.injectLambdaContext`
 *
 *     // Decorate your handler class method
 *     @logger.injectLambdaContext()
 *     public async handler(_event: any, _context: any): Promise<void> {
 *         logger.info('This is an INFO log with some context');
 *     }
 * }
 *
 * const handlerClass = new Lambda();
 * export const handler = handlerClass.handler.bind(handlerClass);
 * ```
 *
 * ### Functions usage with manual instrumentation
 *
 * If you prefer to manually instrument your Lambda handler you can use the methods in the Logger class directly.
 *
 * @example
 * ```typescript
 * import { Logger } from '@aws-lambda-powertools/logger';
 *
 * const logger = new Logger();
 *
 * export const handler = async (_event, context) => {
 *     logger.addContext(context);
 *     logger.info('This is an INFO log with some context');
 * };
 * ```
 *
 * @class
 * @implements {ClassThatLogs}
 * @see https://docs.powertools.aws.dev/lambda-typescript/latest/core/logger/
 */
class Logger extends Utility implements ClassThatLogs {
  /**
   * Console instance used to print logs.
   *
   * In AWS Lambda, we create a new instance of the Console class so that we can have
   * full control over the output of the logs. In testing environments, we use the
   * default console instance.
   *
   * This property is initialized in the constructor in setOptions().
   *
   * @private
   */
  private console!: Console;

  private customConfigService?: ConfigServiceInterface;

  // envVarsService is always initialized in the constructor in setOptions()
  private envVarsService!: EnvironmentVariablesService;

  private logEvent = false;

  private logFormatter?: LogFormatterInterface;

  private logIndentation: number = LogJsonIndent.COMPACT;

  /**
   * Log level used internally by the current instance of Logger.
   */
  private logLevel = 12;

  /**
   * Log level thresholds used internally by the current instance of Logger.
   *
   * The levels are in ascending order from the most verbose to the least verbose (no logs).
   */
  private readonly logLevelThresholds: LogLevelThresholds = {
    DEBUG: 8,
    INFO: 12,
    WARN: 16,
    ERROR: 20,
    CRITICAL: 24,
    SILENT: 28,
  };

  private logsSampled = false;

  private persistentLogAttributes?: LogAttributes = {};

  private powertoolLogData: PowertoolLogData = <PowertoolLogData>{};

  /**
   * Log level used by the current instance of Logger.
   *
   * Returns the log level as a number. The higher the number, the less verbose the logs.
   * To get the log level name, use the {@link getLevelName()} method.
   */
  public get level(): number {
    return this.logLevel;
  }

  /**
   * It initializes the Logger class with an optional set of options (settings).
   * *
   * @param {ConstructorOptions} options
   */
  public constructor(options: ConstructorOptions = {}) {
    super();
    this.setOptions(options);
  }

  /**
   * It adds the current Lambda function's invocation context data to the powertoolLogData property of the instance.
   * This context data will be part of all printed log items.
   *
   * @param {Context} context
   * @returns {void}
   */
  public addContext(context: Context): void {
    const lambdaContext: Partial<LambdaFunctionContext> = {
      invokedFunctionArn: context.invokedFunctionArn,
      coldStart: this.getColdStart(),
      awsRequestId: context.awsRequestId,
      memoryLimitInMB: Number(context.memoryLimitInMB),
      functionName: context.functionName,
      functionVersion: context.functionVersion,
    };

    this.addToPowertoolLogData({
      lambdaContext,
    });
  }

  /**
   * It adds the given attributes (key-value pairs) to all log items generated by this Logger instance.
   *
   * @param {LogAttributes} attributes
   * @returns {void}
   */
  public addPersistentLogAttributes(attributes?: LogAttributes): void {
    merge(this.persistentLogAttributes, attributes);
  }

  /**
   * Alias for addPersistentLogAttributes.
   *
   * @param {LogAttributes} attributes
   * @returns {void}
   */
  public appendKeys(attributes?: LogAttributes): void {
    this.addPersistentLogAttributes(attributes);
  }

  /**
   * It creates a separate Logger instance, identical to the current one
   * It's possible to overwrite the new instance options by passing them.
   *
   * @param {ConstructorOptions} options
   * @returns {Logger}
   */
  public createChild(options: ConstructorOptions = {}): Logger {
    const parentsOptions = {
      logLevel: this.getLevelName(),
      customConfigService: this.getCustomConfigService(),
      logFormatter: this.getLogFormatter(),
    };
    const parentsPowertoolsLogData = this.getPowertoolLogData();
    const childLogger = new Logger(
      merge(parentsOptions, parentsPowertoolsLogData, options)
    );

    const parentsPersistentLogAttributes = this.getPersistentLogAttributes();
    childLogger.addPersistentLogAttributes(parentsPersistentLogAttributes);

    if (parentsPowertoolsLogData.lambdaContext) {
      childLogger.addContext(parentsPowertoolsLogData.lambdaContext as Context);
    }

    return childLogger;
  }

  /**
   * It prints a log item with level CRITICAL.
   *
   * @param {LogItemMessage} input
   * @param {Error | LogAttributes | string} extraInput
   */
  public critical(
    input: LogItemMessage,
    ...extraInput: LogItemExtraInput
  ): void {
    this.processLogItem(24, input, extraInput);
  }

  /**
   * It prints a log item with level DEBUG.
   *
   * @param {LogItemMessage} input
   * @param {Error | LogAttributes | string} extraInput
   * @returns {void}
   */
  public debug(input: LogItemMessage, ...extraInput: LogItemExtraInput): void {
    this.processLogItem(8, input, extraInput);
  }

  /**
   * It prints a log item with level ERROR.
   *
   * @param {LogItemMessage} input
   * @param {Error | LogAttributes | string} extraInput
   * @returns {void}
   */
  public error(input: LogItemMessage, ...extraInput: LogItemExtraInput): void {
    this.processLogItem(20, input, extraInput);
  }

  /**
   * Get the log level name of the current instance of Logger.
   *
   * It returns the log level name, i.e. `INFO`, `DEBUG`, etc.
   * To get the log level as a number, use the {@link Logger.level} property.
   *
   * @returns {Uppercase<LogLevel>} The log level name.
   */
  public getLevelName(): Uppercase<LogLevel> {
    return this.getLogLevelNameFromNumber(this.logLevel);
  }

  /**
   * It returns a boolean value. True means that the Lambda invocation events
   * are printed in the logs.
   *
   * @returns {boolean}
   */
  public getLogEvent(): boolean {
    return this.logEvent;
  }

  /**
   * It returns a boolean value, if true all the logs will be printed.
   *
   * @returns {boolean}
   */
  public getLogsSampled(): boolean {
    return this.logsSampled;
  }

  /**
   * It returns the persistent log attributes, which are the attributes
   * that will be logged in all log items.
   *
   * @private
   * @returns {LogAttributes}
   */
  public getPersistentLogAttributes(): LogAttributes {
    return this.persistentLogAttributes as LogAttributes;
  }

  /**
   * It prints a log item with level INFO.
   *
   * @param {LogItemMessage} input
   * @param {Error | LogAttributes | string} extraInput
   * @returns {void}
   */
  public info(input: LogItemMessage, ...extraInput: LogItemExtraInput): void {
    this.processLogItem(12, input, extraInput);
  }

  /**
   * Method decorator that adds the current Lambda function context as extra
   * information in all log items.
   *
   * The decorator can be used only when attached to a Lambda function handler which
   * is written as method of a class, and should be declared just before the handler declaration.
   *
   * Note: Currently TypeScript only supports decorators on classes and methods. If you are using the
   * function syntax, you should use the middleware instead.
   *
   * @example
   * ```typescript
   * import { Logger } from '@aws-lambda-powertools/logger';
   * import { LambdaInterface } from '@aws-lambda-powertools/commons';
   *
   * const logger = new Logger();
   *
   * class Lambda implements LambdaInterface {
   *     // Decorate your handler class method
   *     @logger.injectLambdaContext()
   *     public async handler(_event: any, _context: any): Promise<void> {
   *         logger.info('This is an INFO log with some context');
   *     }
   * }
   *
   * const handlerClass = new Lambda();
   * export const handler = handlerClass.handler.bind(handlerClass);
   * ```
   *
   * @see https://www.typescriptlang.org/docs/handbook/decorators.html#method-decorators
   * @returns {HandlerMethodDecorator}
   */
  public injectLambdaContext(options?: HandlerOptions): HandlerMethodDecorator {
    return (_target, _propertyKey, descriptor) => {
      /**
       * The descriptor.value is the method this decorator decorates, it cannot be undefined.
       */
      /* eslint-disable  @typescript-eslint/no-non-null-assertion */
      const originalMethod = descriptor.value!;

      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const loggerRef = this;
      // Use a function() {} instead of an () => {} arrow function so that we can
      // access `myClass` as `this` in a decorated `myClass.myMethod()`.
      descriptor.value = async function (
        this: Handler,
        event,
        context,
        callback
      ) {
        let initialPersistentAttributes = {};
        if (options && options.clearState === true) {
          initialPersistentAttributes = {
            ...loggerRef.getPersistentLogAttributes(),
          };
        }

        Logger.injectLambdaContextBefore(loggerRef, event, context, options);

        let result: unknown;
        try {
          result = await originalMethod.apply(this, [event, context, callback]);
        } catch (error) {
          throw error;
        } finally {
          Logger.injectLambdaContextAfterOrOnError(
            loggerRef,
            initialPersistentAttributes,
            options
          );
        }

        return result;
      };
    };
  }

  public static injectLambdaContextAfterOrOnError(
    logger: Logger,
    initialPersistentAttributes: LogAttributes,
    options?: HandlerOptions
  ): void {
    if (options && options.clearState === true) {
      logger.setPersistentLogAttributes(initialPersistentAttributes);
    }
  }

  public static injectLambdaContextBefore(
    logger: Logger,
    event: unknown,
    context: Context,
    options?: HandlerOptions
  ): void {
    logger.addContext(context);

    let shouldLogEvent = undefined;
    if (options && options.hasOwnProperty('logEvent')) {
      shouldLogEvent = options.logEvent;
    }
    logger.logEventIfEnabled(event, shouldLogEvent);
  }

  /**
   * Logs a Lambda invocation event, if it *should*.
   *
   ** @param {unknown} event
   * @param {boolean} [overwriteValue]
   * @returns {void}
   */
  public logEventIfEnabled(event: unknown, overwriteValue?: boolean): void {
    if (!this.shouldLogEvent(overwriteValue)) {
      return;
    }
    this.info('Lambda invocation event', { event });
  }

  /**
   * If the sample rate feature is enabled, the calculation that determines whether the logs
   * will actually be printed or not for this invocation is done when the Logger class is
   * initialized.
   * This method will repeat that calculation (with possible different outcome).
   *
   * @returns {void}
   */
  public refreshSampleRateCalculation(): void {
    this.setLogsSampled();
  }

  /**
   * Alias for removePersistentLogAttributes.
   *
   * @param {string[]} keys
   * @returns {void}
   */
  public removeKeys(keys: string[]): void {
    this.removePersistentLogAttributes(keys);
  }

  /**
   * It removes attributes based on provided keys to all log items generated by this Logger instance.
   *
   * @param {string[]} keys
   * @returns {void}
   */
  public removePersistentLogAttributes(keys: string[]): void {
    keys.forEach((key) => {
      if (this.persistentLogAttributes && key in this.persistentLogAttributes) {
        delete this.persistentLogAttributes[key];
      }
    });
  }

  /**
   * Set the log level for this Logger instance.
   *
   * @param logLevel The log level to set, i.e. `error`, `warn`, `info`, `debug`, etc.
   */
  public setLogLevel(logLevel: LogLevel): void {
    if (this.isValidLogLevel(logLevel)) {
      this.logLevel = this.logLevelThresholds[logLevel];
    } else {
      throw new Error(`Invalid log level: ${logLevel}`);
    }
  }

  /**
   * It sets the given attributes (key-value pairs) to all log items generated by this Logger instance.
   * Note: this replaces the pre-existing value.
   *
   * @param {LogAttributes} attributes
   * @returns {void}
   */
  public setPersistentLogAttributes(attributes: LogAttributes): void {
    this.persistentLogAttributes = attributes;
  }

  /**
   * It sets the user-provided sample rate value.
   *
   * @param {number} [sampleRateValue]
   * @returns {void}
   */
  public setSampleRateValue(sampleRateValue?: number): void {
    this.powertoolLogData.sampleRateValue =
      sampleRateValue ||
      this.getCustomConfigService()?.getSampleRateValue() ||
      this.getEnvVarsService().getSampleRateValue();
  }

  /**
   * It checks whether the current Lambda invocation event should be printed in the logs or not.
   *
   * @private
   * @param {boolean} [overwriteValue]
   * @returns {boolean}
   */
  public shouldLogEvent(overwriteValue?: boolean): boolean {
    if (typeof overwriteValue === 'boolean') {
      return overwriteValue;
    }

    return this.getLogEvent();
  }

  /**
   * It prints a log item with level WARN.
   *
   * @param {LogItemMessage} input
   * @param {Error | LogAttributes | string} extraInput
   * @returns {void}
   */
  public warn(input: LogItemMessage, ...extraInput: LogItemExtraInput): void {
    this.processLogItem(16, input, extraInput);
  }

  /**
   * Decides whether the current log item should be printed or not.
   *
   * The decision is based on the log level and the sample rate value.
   * A log item will be printed if:
   * 1. The log level is greater than or equal to the Logger's log level.
   * 2. The log level is less than the Logger's log level, but the
   * current sampling value is set to `true`.
   *
   * @param {number} logLevel
   * @returns {boolean}
   * @protected
   */
  protected shouldPrint(logLevel: number): boolean {
    if (logLevel >= this.logLevel) {
      return true;
    }

    return this.getLogsSampled();
  }

  /**
   * It stores information that is printed in all log items.
   *
   * @param {Partial<PowertoolLogData>} attributesArray
   * @private
   * @returns {void}
   */
  private addToPowertoolLogData(
    ...attributesArray: Array<Partial<PowertoolLogData>>
  ): void {
    attributesArray.forEach((attributes: Partial<PowertoolLogData>) => {
      merge(this.powertoolLogData, attributes);
    });
  }

  /**
   * It processes a particular log item so that it can be printed to stdout:
   * - Merges ephemeral log attributes with persistent log attributes (printed for all logs) and additional info;
   * - Formats all the log attributes;
   *
   * @private
   * @param {number} logLevel
   * @param {LogItemMessage} input
   * @param {LogItemExtraInput} extraInput
   * @returns {LogItem}
   */
  private createAndPopulateLogItem(
    logLevel: number,
    input: LogItemMessage,
    extraInput: LogItemExtraInput
  ): LogItem {
    // TODO: this method's logic is hard to understand, there is an opportunity here to simplify this logic.
    const unformattedBaseAttributes = merge(
      {
        logLevel: this.getLogLevelNameFromNumber(logLevel),
        timestamp: new Date(),
        message: typeof input === 'string' ? input : input.message,
        xRayTraceId: this.envVarsService.getXrayTraceId(),
      },
      this.getPowertoolLogData()
    );

    const logItem = new LogItem({
      baseAttributes: this.getLogFormatter().formatAttributes(
        unformattedBaseAttributes
      ),
      persistentAttributes: this.getPersistentLogAttributes(),
    });

    // Add ephemeral attributes
    if (typeof input !== 'string') {
      logItem.addAttributes(input);
    }
    extraInput.forEach((item: Error | LogAttributes | string) => {
      const attributes: LogAttributes =
        item instanceof Error
          ? { error: item }
          : typeof item === 'string'
          ? { extra: item }
          : item;

      logItem.addAttributes(attributes);
    });

    return logItem;
  }

  /**
   * It returns the custom config service, an abstraction used to fetch environment variables.
   *
   * @private
   * @returns {ConfigServiceInterface | undefined}
   */
  private getCustomConfigService(): ConfigServiceInterface | undefined {
    return this.customConfigService;
  }

  /**
   * It returns the instance of a service that fetches environment variables.
   *
   * @private
   * @returns {EnvironmentVariablesService}
   */
  private getEnvVarsService(): EnvironmentVariablesService {
    return this.envVarsService as EnvironmentVariablesService;
  }

  /**
   * It returns the instance of a service that formats the structure of a
   * log item's keys and values in the desired way.
   *
   * @private
   * @returns {LogFormatterInterface}
   */
  private getLogFormatter(): LogFormatterInterface {
    return this.logFormatter as LogFormatterInterface;
  }

  /**
   * Get the log level name from the log level number.
   *
   * For example, if the log level is 16, it will return 'WARN'.
   *
   * @param logLevel - The log level to get the name of
   * @returns - The name of the log level
   */
  private getLogLevelNameFromNumber(logLevel: number): Uppercase<LogLevel> {
    const found = Object.entries(this.logLevelThresholds).find(
      ([key, value]) => {
        if (value === logLevel) {
          return key;
        }
      }
    )!;

    return found[0] as Uppercase<LogLevel>;
  }

  /**
   * It returns information that will be added in all log item by
   * this Logger instance (different from user-provided persistent attributes).
   *
   * @private
   * @returns {LogAttributes}
   */
  private getPowertoolLogData(): PowertoolLogData {
    return this.powertoolLogData;
  }

  /**
   * When the data added in the log item contains object references or BigInt values,
   * `JSON.stringify()` can't handle them and instead throws errors:
   * `TypeError: cyclic object value` or `TypeError: Do not know how to serialize a BigInt`.
   * To mitigate these issues, this method will find and remove all cyclic references and convert BigInt values to strings.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#exceptions
   * @private
   */
  private getReplacer(): (
    key: string,
    value: LogAttributes | Error | bigint
  ) => void {
    const references = new WeakSet();

    return (key, value) => {
      let item = value;
      if (item instanceof Error) {
        item = this.getLogFormatter().formatError(item);
      }
      if (typeof item === 'bigint') {
        return item.toString();
      }
      if (typeof item === 'object' && value !== null) {
        if (references.has(item)) {
          return;
        }
        references.add(item);
      }

      return item;
    };
  }

  /**
   * It returns the numeric sample rate value.
   *
   * @private
   * @returns {number}
   */
  private getSampleRateValue(): number {
    if (!this.powertoolLogData.sampleRateValue) {
      this.setSampleRateValue();
    }

    return this.powertoolLogData.sampleRateValue as number;
  }

  /**
   * It returns true and type guards the log level if a given log level is valid.
   *
   * @param {LogLevel} logLevel
   * @private
   * @returns {boolean}
   */
  private isValidLogLevel(
    logLevel?: LogLevel | string
  ): logLevel is Uppercase<LogLevel> {
    return typeof logLevel === 'string' && logLevel in this.logLevelThresholds;
  }

  /**
   * It prints a given log with given log level.
   *
   * @param {number} logLevel
   * @param {LogItem} log
   * @private
   */
  private printLog(logLevel: number, log: LogItem): void {
    log.prepareForPrint();

    const consoleMethod =
      logLevel === 24
        ? 'error'
        : (this.getLogLevelNameFromNumber(logLevel).toLowerCase() as keyof Omit<
            ClassThatLogs,
            'critical'
          >);

    this.console[consoleMethod](
      JSON.stringify(
        log.getAttributes(),
        this.getReplacer(),
        this.logIndentation
      )
    );
  }

  /**
   * It prints a given log with given log level.
   *
   * @param {number} logLevel
   * @param {LogItemMessage} input
   * @param {LogItemExtraInput} extraInput
   * @private
   */
  private processLogItem(
    logLevel: number,
    input: LogItemMessage,
    extraInput: LogItemExtraInput
  ): void {
    if (!this.shouldPrint(logLevel)) {
      return;
    }
    this.printLog(
      logLevel,
      this.createAndPopulateLogItem(logLevel, input, extraInput)
    );
  }

  /**
   * It initializes console property as an instance of the internal version of Console() class (PR #748)
   * or as the global node console if the `POWERTOOLS_DEV' env variable is set and has truthy value.
   *
   * @private
   * @returns {void}
   */
  private setConsole(): void {
    if (!this.getEnvVarsService().isDevMode()) {
      this.console = new Console({
        stdout: process.stdout,
        stderr: process.stderr,
      });
    } else {
      this.console = console;
    }
  }

  /**
   * Sets the Logger's customer config service instance, which will be used
   * to fetch environment variables.
   *
   * @private
   * @param {ConfigServiceInterface} customConfigService
   * @returns {void}
   */
  private setCustomConfigService(
    customConfigService?: ConfigServiceInterface
  ): void {
    this.customConfigService = customConfigService
      ? customConfigService
      : undefined;
  }

  /**
   * Sets the Logger's custom config service instance, which will be used
   * to fetch environment variables.
   *
   * @private
   * @returns {void}
   */
  private setEnvVarsService(): void {
    this.envVarsService = new EnvironmentVariablesService();
  }

  /**
   * Sets the initial Logger log level based on the following order:
   * 1. If a log level is passed to the constructor, it sets it.
   * 2. If a log level is set via custom config service, it sets it.
   * 3. If a log level is set via env variables, it sets it.
   *
   * If none of the above is true, the default log level applies (INFO).
   *
   * @private
   * @param {LogLevel} [logLevel] - Log level passed to the constructor
   */
  private setInitialLogLevel(logLevel?: LogLevel): void {
    const constructorLogLevel = logLevel?.toUpperCase();
    if (this.isValidLogLevel(constructorLogLevel)) {
      this.logLevel = this.logLevelThresholds[constructorLogLevel];

      return;
    }
    const customConfigValue = this.getCustomConfigService()
      ?.getLogLevel()
      ?.toUpperCase();
    if (this.isValidLogLevel(customConfigValue)) {
      this.logLevel = this.logLevelThresholds[customConfigValue];

      return;
    }
    const envVarsValue = this.getEnvVarsService()?.getLogLevel()?.toUpperCase();
    if (this.isValidLogLevel(envVarsValue)) {
      this.logLevel = this.logLevelThresholds[envVarsValue];

      return;
    }
  }

  /**
   * If the log event feature is enabled via env variable, it sets a property that tracks whether
   * the event passed to the Lambda function handler should be logged or not.
   *
   * @private
   * @returns {void}
   */
  private setLogEvent(): void {
    if (this.getEnvVarsService().getLogEvent()) {
      this.logEvent = true;
    }
  }

  /**
   * It sets the log formatter instance, in charge of giving a custom format
   * to the structured logs
   *
   * @private
   * @param {LogFormatterInterface} logFormatter
   * @returns {void}
   */
  private setLogFormatter(logFormatter?: LogFormatterInterface): void {
    this.logFormatter = logFormatter || new PowertoolLogFormatter();
  }

  /**
   * If the `POWERTOOLS_DEV' env variable is set,
   * it adds JSON indentation for pretty printing logs.
   *
   * @private
   * @returns {void}
   */
  private setLogIndentation(): void {
    if (this.getEnvVarsService().isDevMode()) {
      this.logIndentation = LogJsonIndent.PRETTY;
    }
  }

  /**
   * If the sample rate feature is enabled, it sets a property that tracks whether this Lambda function invocation
   * will print logs or not.
   *
   * @private
   * @returns {void}
   */
  private setLogsSampled(): void {
    const sampleRateValue = this.getSampleRateValue();
    this.logsSampled =
      sampleRateValue !== undefined &&
      (sampleRateValue === 1 || randomInt(0, 100) / 100 <= sampleRateValue);
  }

  /**
   * It configures the Logger instance settings that will affect the Logger's behaviour
   * and the content of all logs.
   *
   * @private
   * @param {ConstructorOptions} options
   * @returns {Logger}
   */
  private setOptions(options: ConstructorOptions): Logger {
    const {
      logLevel,
      serviceName,
      sampleRateValue,
      logFormatter,
      customConfigService,
      persistentLogAttributes,
      environment,
    } = options;

    this.setEnvVarsService();
    // order is important, it uses EnvVarsService()
    this.setConsole();
    this.setCustomConfigService(customConfigService);
    this.setInitialLogLevel(logLevel);
    this.setSampleRateValue(sampleRateValue);
    this.setLogsSampled();
    this.setLogFormatter(logFormatter);
    this.setPowertoolLogData(serviceName, environment);
    this.setLogEvent();
    this.setLogIndentation();

    this.addPersistentLogAttributes(persistentLogAttributes);

    return this;
  }

  /**
   * It adds important data to the Logger instance that will affect the content of all logs.
   *
   * @param {string} serviceName
   * @param {Environment} environment
   * @param {LogAttributes} persistentLogAttributes
   * @private
   * @returns {void}
   */
  private setPowertoolLogData(
    serviceName?: string,
    environment?: Environment,
    persistentLogAttributes: LogAttributes = {}
  ): void {
    this.addToPowertoolLogData(
      {
        awsRegion: this.getEnvVarsService().getAwsRegion(),
        environment:
          environment ||
          this.getCustomConfigService()?.getCurrentEnvironment() ||
          this.getEnvVarsService().getCurrentEnvironment(),
        sampleRateValue: this.getSampleRateValue(),
        serviceName:
          serviceName ||
          this.getCustomConfigService()?.getServiceName() ||
          this.getEnvVarsService().getServiceName() ||
          this.getDefaultServiceName(),
      },
      persistentLogAttributes
    );
  }
}

export { Logger };
