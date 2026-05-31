import { v4 as uuidv4 } from 'uuid';
import type { HMMModel, SQLRuleConfig, SQLRuleResult } from '../../shared/types.js';
import { dataStore } from './datastore.js';

type DatabaseType = 'postgres' | 'mysql' | 'bigquery' | 'snowflake';

function generateStateLabels(nStates: number): string[] {
  const labels: string[] = [];
  for (let i = 0; i < nStates; i++) {
    labels.push(`S${i}`);
  }
  return labels;
}

function serializeTransitionMatrix(A: number[][], stateNames: string[]): string {
  const lines: string[] = [];
  lines.push('-- 状态转移概率矩阵');
  lines.push('-- ' + stateNames.join('\t') + '\t' + stateNames.join('\t'));
  for (let i = 0; i < A.length; i++) {
    let line = `-- ${stateNames[i]}\t`;
    for (let j = 0; j < A[i].length; j++) {
      line += A[i][j].toFixed(4) + '\t';
    }
    lines.push(line);
  }
  lines.push('');
  return lines.join('\n');
}

function serializeEmissionParameters(
  mu: number[][],
  sigma: number[][][],
  featureNames: string[]
): string {
  const lines: string[] = [];
  lines.push('-- 高斯发射参数');
  for (let i = 0; i < mu.length; i++) {
    lines.push(`-- 状态 S${i}:`);
    lines.push(`--   均值 (mu): [${mu[i].map(v => v.toFixed(4)).join(', ')}]`);
    const diagSigma = sigma[i].map((row, idx) => row[idx]);
    lines.push(`--   方差 (sigma diag): [${diagSigma.map(v => v.toFixed(4)).join(', ')}]`);
  }
  lines.push('');
  return lines.join('\n');
}

function zScoreSQL(col: string, mean: number, std: number, dbType: DatabaseType): string {
  const safeStd = Math.max(std, 1e-10);
  return `(${col} - ${mean.toFixed(6)}) / ${safeStd.toFixed(6)}`;
}

function lagWindowSQL(col: string, n: number, dbType: DatabaseType): string {
  switch (dbType) {
    case 'postgres':
    case 'bigquery':
    case 'snowflake':
      return `LAG(${col}, ${n}) OVER (ORDER BY time_column)`;
    case 'mysql':
      return `LAG(${col}, ${n}) OVER (ORDER BY time_column)`;
    default:
      return `LAG(${col}, ${n}) OVER (ORDER BY time_column)`;
  }
}

function arrayAggSQL(col: string, dbType: DatabaseType): string {
  switch (dbType) {
    case 'postgres':
      return `ARRAY_AGG(${col})`;
    case 'mysql':
      return `JSON_ARRAYAGG(${col})`;
    case 'bigquery':
      return `ARRAY_AGG(${col})`;
    case 'snowflake':
      return `ARRAY_AGG(${col})`;
    default:
      return `ARRAY_AGG(${col})`;
  }
}

function mahalanobisDistanceSQL(
  featureCols: string[],
  mu: number[],
  sigma: number[][],
  dbType: DatabaseType
): string {
  const terms: string[] = [];
  for (let i = 0; i < featureCols.length; i++) {
    const variance = Math.max(sigma[i][i], 1e-10);
    terms.push(`POWER(${featureCols[i]} - ${mu[i].toFixed(6)}, 2) / ${variance.toFixed(6)}`);
  }
  return `SQRT(${terms.join(' + ')})`;
}

function generateFeatureCTE(
  config: SQLRuleConfig,
  featureNames: string[]
): string {
  const { timeColumn, valueColumn } = config;
  const lines: string[] = [];
  lines.push('feature_calculation AS (');
  lines.push('  SELECT');
  lines.push(`    ${timeColumn} AS time_column,`);
  if (config.assetColumn) {
    lines.push(`    ${config.assetColumn} AS asset,`);
  }
  lines.push(`    ${valueColumn} AS value,`);
  lines.push(`    (${valueColumn} / NULLIF(LAG(${valueColumn}, 1) OVER (ORDER BY ${timeColumn}), 0) - 1) AS feature_return,`);
  lines.push(`    AVG(${valueColumn}) OVER (ORDER BY ${timeColumn} ROWS BETWEEN 9 PRECEDING AND CURRENT ROW) AS feature_ma10,`);
  lines.push(`    AVG(${valueColumn}) OVER (ORDER BY ${timeColumn} ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) AS feature_ma30,`);
  lines.push(`    STDDEV(${valueColumn}) OVER (ORDER BY ${timeColumn} ROWS BETWEEN 9 PRECEDING AND CURRENT ROW) AS feature_vol10`);
  lines.push('  FROM source_data');
  lines.push(')');
  return lines.join('\n');
}

function generateZScoreCTE(
  config: SQLRuleConfig,
  dbType: DatabaseType
): string {
  const lines: string[] = [];
  lines.push('zscore_calculation AS (');
  lines.push('  SELECT');
  lines.push('    time_column,');
  if (config.assetColumn) {
    lines.push('    asset,');
  }
  lines.push('    value,');
  lines.push('    feature_return,');
  lines.push('    feature_ma10,');
  lines.push('    feature_ma30,');
  lines.push('    feature_vol10,');
  lines.push('    (feature_return - AVG(feature_return) OVER ()) / NULLIF(STDDEV(feature_return) OVER (), 0) AS z_return,');
  lines.push('    (feature_vol10 - AVG(feature_vol10) OVER ()) / NULLIF(STDDEV(feature_vol10) OVER (), 0) AS z_volatility');
  lines.push('  FROM feature_calculation');
  lines.push(')');
  return lines.join('\n');
}

function generateForwardProbCTE(
  model: HMMModel,
  config: SQLRuleConfig,
  dbType: DatabaseType
): string {
  const stateLabels = generateStateLabels(model.pi.length);
  const lines: string[] = [];
  lines.push('forward_probability AS (');
  lines.push('  SELECT');
  lines.push('    time_column,');
  if (config.assetColumn) {
    lines.push('    asset,');
  }
  lines.push('    value,');
  lines.push('    z_return,');
  lines.push('    z_volatility,');
  
  const mahalanobisTerms: string[] = [];
  for (let i = 0; i < model.mu.length; i++) {
    const distSQL = mahalanobisDistanceSQL(
      ['z_return', 'z_volatility'],
      model.mu[i],
      model.sigma[i],
      dbType
    );
    mahalanobisTerms.push(`    ${distSQL} AS dist_S${i}`);
  }
  lines.push(mahalanobisTerms.join(',\n'));
  lines.push('  FROM zscore_calculation');
  lines.push(')');
  return lines.join('\n');
}

function generateAnomalyScoreCTE(
  model: HMMModel,
  config: SQLRuleConfig,
  dbType: DatabaseType
): string {
  const stateLabels = generateStateLabels(model.pi.length);
  const lines: string[] = [];
  lines.push('anomaly_scores AS (');
  lines.push('  SELECT');
  lines.push('    time_column,');
  if (config.assetColumn) {
    lines.push('    asset,');
  }
  lines.push('    value,');
  lines.push('    z_return,');
  lines.push('    z_volatility,');
  
  const minDistTerms: string[] = [];
  for (let i = 0; i < model.mu.length; i++) {
    minDistTerms.push(`dist_S${i}`);
  }
  lines.push(`    LEAST(${minDistTerms.join(', ')}) AS min_mahalanobis,`);
  
  const avgDistTerms: string[] = [];
  for (let i = 0; i < model.mu.length; i++) {
    avgDistTerms.push(`dist_S${i} * ${model.pi[i].toFixed(6)}`);
  }
  lines.push(`    (${avgDistTerms.join(' + ')}) AS weighted_mahalanobis,`);
  lines.push('    ROW_NUMBER() OVER (ORDER BY time_column) AS row_num');
  lines.push('  FROM forward_probability');
  lines.push(')');
  return lines.join('\n');
}

function generateFinalSelect(
  model: HMMModel,
  config: SQLRuleConfig,
  dbType: DatabaseType
): string {
  const { thresholdK, timeColumn, includeAssetFilter, assetColumn } = config;
  const lines: string[] = [];
  lines.push('SELECT');
  lines.push('  time_column AS timestamp,');
  if (assetColumn) {
    lines.push('  asset,');
  }
  lines.push('  value,');
  lines.push('  min_mahalanobis,');
  lines.push('  weighted_mahalanobis,');
  lines.push('  (min_mahalanobis - (SELECT AVG(min_mahalanobis) FROM anomaly_scores)) / NULLIF((SELECT STDDEV(min_mahalanobis) FROM anomaly_scores), 0) AS anomaly_zscore,');
  lines.push('  CASE');
  lines.push('    WHEN (min_mahalanobis - (SELECT AVG(min_mahalanobis) FROM anomaly_scores)) / NULLIF((SELECT STDDEV(min_mahalanobis) FROM anomaly_scores), 0) > {{threshold}} THEN 1');
  lines.push('    ELSE 0');
  lines.push('  END AS is_anomaly');
  lines.push('FROM anomaly_scores');
  lines.push('WHERE');
  lines.push(`  time_column BETWEEN '{{start_time}}' AND '{{end_time}}'`);
  if (includeAssetFilter && assetColumn) {
    lines.push(`  AND asset = '{{asset_name}}'`);
  }
  lines.push('ORDER BY time_column;');
  return lines.join('\n');
}

function generatePostgreSQLRule(model: HMMModel, config: SQLRuleConfig): string {
  const stateLabels = generateStateLabels(model.pi.length);
  const featureNames = ['return', 'volatility'];
  
  const header = `-- ============================================
-- HMM异常检测SQL规则 (PostgreSQL)
-- 规则名称: ${config.ruleName}
-- 规则描述: ${config.ruleDescription}
-- 阈值参数: k = ${config.thresholdK}
-- 状态数量: ${model.pi.length}
-- ============================================
`;

  const transitionComment = serializeTransitionMatrix(model.A, stateLabels);
  const emissionComment = serializeEmissionParameters(model.mu, model.sigma, featureNames);

  const ctes = [
    `WITH source_data AS (
  SELECT * FROM your_table_name
),
${generateFeatureCTE(config, featureNames)},
${generateZScoreCTE(config, 'postgres')},
${generateForwardProbCTE(model, config, 'postgres')},
${generateAnomalyScoreCTE(model, config, 'postgres')}
`];

  const finalSelect = generateFinalSelect(model, config, 'postgres');

  return header + transitionComment + emissionComment + ctes.join('\n') + finalSelect;
}

function generateMySQLRule(model: HMMModel, config: SQLRuleConfig): string {
  const stateLabels = generateStateLabels(model.pi.length);
  const featureNames = ['return', 'volatility'];

  const header = `-- ============================================
-- HMM异常检测SQL规则 (MySQL)
-- 规则名称: ${config.ruleName}
-- 规则描述: ${config.ruleDescription}
-- 阈值参数: k = ${config.thresholdK}
-- 状态数量: ${model.pi.length}
-- ============================================
`;

  const transitionComment = serializeTransitionMatrix(model.A, stateLabels);
  const emissionComment = serializeEmissionParameters(model.mu, model.sigma, featureNames);

  const ctes = [
    `WITH source_data AS (
  SELECT * FROM your_table_name
),
${generateFeatureCTE(config, featureNames)},
${generateZScoreCTE(config, 'mysql')},
${generateForwardProbCTE(model, config, 'mysql')},
${generateAnomalyScoreCTE(model, config, 'mysql')}
`];

  const finalSelect = generateFinalSelect(model, config, 'mysql');

  return header + transitionComment + emissionComment + ctes.join('\n') + finalSelect;
}

function generateBigQueryRule(model: HMMModel, config: SQLRuleConfig): string {
  const stateLabels = generateStateLabels(model.pi.length);
  const featureNames = ['return', 'volatility'];

  const header = `-- ============================================
-- HMM异常检测SQL规则 (BigQuery)
-- 规则名称: ${config.ruleName}
-- 规则描述: ${config.ruleDescription}
-- 阈值参数: k = ${config.thresholdK}
-- 状态数量: ${model.pi.length}
-- ============================================
`;

  const transitionComment = serializeTransitionMatrix(model.A, stateLabels);
  const emissionComment = serializeEmissionParameters(model.mu, model.sigma, featureNames);

  const ctes = [
    `WITH source_data AS (
  SELECT * FROM \`your_project.your_dataset.your_table\`
),
${generateFeatureCTE(config, featureNames)},
${generateZScoreCTE(config, 'bigquery')},
${generateForwardProbCTE(model, config, 'bigquery')},
${generateAnomalyScoreCTE(model, config, 'bigquery')}
`];

  const finalSelect = generateFinalSelect(model, config, 'bigquery');

  return header + transitionComment + emissionComment + ctes.join('\n') + finalSelect;
}

function generateSnowflakeRule(model: HMMModel, config: SQLRuleConfig): string {
  const stateLabels = generateStateLabels(model.pi.length);
  const featureNames = ['return', 'volatility'];

  const header = `-- ============================================
-- HMM异常检测SQL规则 (Snowflake)
-- 规则名称: ${config.ruleName}
-- 规则描述: ${config.ruleDescription}
-- 阈值参数: k = ${config.thresholdK}
-- 状态数量: ${model.pi.length}
-- ============================================
`;

  const transitionComment = serializeTransitionMatrix(model.A, stateLabels);
  const emissionComment = serializeEmissionParameters(model.mu, model.sigma, featureNames);

  const ctes = [
    `WITH source_data AS (
  SELECT * FROM YOUR_SCHEMA.YOUR_TABLE
),
${generateFeatureCTE(config, featureNames)},
${generateZScoreCTE(config, 'snowflake')},
${generateForwardProbCTE(model, config, 'snowflake')},
${generateAnomalyScoreCTE(model, config, 'snowflake')}
`];

  const finalSelect = generateFinalSelect(model, config, 'snowflake');

  return header + transitionComment + emissionComment + ctes.join('\n') + finalSelect;
}

function exportSQLRule(model: HMMModel, config: SQLRuleConfig): SQLRuleResult {
  let sql: string;
  
  switch (config.databaseType) {
    case 'postgres':
      sql = generatePostgreSQLRule(model, config);
      break;
    case 'mysql':
      sql = generateMySQLRule(model, config);
      break;
    case 'bigquery':
      sql = generateBigQueryRule(model, config);
      break;
    case 'snowflake':
      sql = generateSnowflakeRule(model, config);
      break;
    default:
      sql = generatePostgreSQLRule(model, config);
  }

  const stateLabels = generateStateLabels(model.pi.length);
  const stateTransitions: string[] = [];
  for (let i = 0; i < model.A.length; i++) {
    for (let j = 0; j < model.A[i].length; j++) {
      stateTransitions.push(`${stateLabels[i]} -> ${stateLabels[j]}: ${model.A[i][j].toFixed(4)}`);
    }
  }

  return {
    id: uuidv4(),
    ruleName: config.ruleName,
    sql,
    databaseType: config.databaseType,
    threshold: config.thresholdK,
    stateTransitions,
    createdAt: new Date().toISOString()
  };
}

export {
  generateStateLabels,
  serializeTransitionMatrix,
  serializeEmissionParameters,
  zScoreSQL,
  lagWindowSQL,
  arrayAggSQL,
  mahalanobisDistanceSQL,
  generatePostgreSQLRule,
  generateMySQLRule,
  generateBigQueryRule,
  generateSnowflakeRule,
  exportSQLRule
};

export default exportSQLRule;
