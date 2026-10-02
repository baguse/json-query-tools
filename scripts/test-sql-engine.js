#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');

async function runSqlEngineTests() {
  console.log('🗄️ Testing In-Memory SQL Query Engine for JSON...');

  // 1. Bundle src/sql/index.ts in memory
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/sql/index.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs'
  });

  const bundledCode = result.outputFiles[0].text;
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', bundledCode);
  fn(mod, mod.exports, require, path.join(__dirname, '../src/sql'));

  const { executeSql, parseSql, formatSql } = mod.exports;

  assert.strictEqual(typeof executeSql, 'function', 'executeSql must be exported as a function');
  assert.strictEqual(typeof parseSql, 'function', 'parseSql must be exported as a function');
  assert.strictEqual(typeof formatSql, 'function', 'formatSql must be exported as a function');

  // Sample Datasets
  const users = [
    { id: 1, name: 'Alice', age: 28, status: 'active', department: 'Engineering', salary: 95000, profile: { city: 'New York', remote: true } },
    { id: 2, name: 'Bob', age: 34, status: 'inactive', department: 'Engineering', salary: 110000, profile: { city: 'San Francisco', remote: false } },
    { id: 3, name: 'Charlie', age: 24, status: 'active', department: 'Design', salary: 75000, profile: { city: 'New York', remote: true } },
    { id: 4, name: 'Diana', age: 41, status: 'active', department: 'Product', salary: 130000, profile: { city: 'Boston', remote: false } },
    { id: 5, name: 'Evan', age: 29, status: 'pending', department: 'Engineering', salary: 88000, profile: { city: 'Chicago', remote: true } }
  ];

  const orders = [
    { orderId: 101, userId: 1, amount: 250, item: 'Laptop Stand' },
    { orderId: 102, userId: 1, amount: 50, item: 'Mouse Pad' },
    { orderId: 103, userId: 2, amount: 1200, item: 'Monitor' },
    { orderId: 104, userId: 4, amount: 300, item: 'Keyboard' }
  ];

  const dataMap = {
    data: users,
    users,
    orders
  };

  console.log('  1. Basic SELECT * and column projection...');
  {
    const resAll = executeSql(dataMap, 'SELECT * FROM data');
    assert.strictEqual(resAll.length, 5);
    assert.strictEqual(resAll[0].name, 'Alice');

    const resCols = executeSql(dataMap, 'SELECT id AS userId, name, salary FROM data');
    assert.strictEqual(resCols.length, 5);
    assert.deepStrictEqual(Object.keys(resCols[0]), ['userId', 'name', 'salary']);
    assert.strictEqual(resCols[0].userId, 1);
  }

  console.log('  2. Nested JSON property access...');
  {
    const res = executeSql(dataMap, 'SELECT name, profile.city AS city, profile.remote AS isRemote FROM data');
    assert.strictEqual(res[0].city, 'New York');
    assert.strictEqual(res[0].isRemote, true);
    assert.strictEqual(res[1].city, 'San Francisco');
    assert.strictEqual(res[1].isRemote, false);
  }

  console.log('  3. Arithmetic and expressions in SELECT...');
  {
    const res = executeSql(dataMap, 'SELECT name, salary * 2 AS doubleSalary, age + 1 AS nextAge FROM data');
    assert.strictEqual(res[0].doubleSalary, 190000);
    assert.strictEqual(res[0].nextAge, 29);
  }

  console.log('  4. WHERE clauses (operators, AND, OR, NOT)...');
  {
    const resGte = executeSql(dataMap, 'SELECT name, age FROM data WHERE age >= 30');
    assert.strictEqual(resGte.length, 2);
    assert.deepStrictEqual(resGte.map(r => r.name), ['Bob', 'Diana']);

    const resAnd = executeSql(dataMap, "SELECT name FROM data WHERE status = 'active' AND age < 30");
    assert.strictEqual(resAnd.length, 2);
    assert.deepStrictEqual(resAnd.map(r => r.name), ['Alice', 'Charlie']);

    const resOr = executeSql(dataMap, "SELECT name FROM data WHERE department = 'Design' OR age > 40");
    assert.strictEqual(resOr.length, 2);
    assert.deepStrictEqual(resOr.map(r => r.name), ['Charlie', 'Diana']);

    const resNot = executeSql(dataMap, "SELECT name FROM data WHERE NOT (status = 'active')");
    assert.strictEqual(resNot.length, 2);
    assert.deepStrictEqual(resNot.map(r => r.name), ['Bob', 'Evan']);
  }

  console.log('  5. WHERE with LIKE, ILIKE, IN, BETWEEN, IS NULL...');
  {
    const resLike = executeSql(dataMap, "SELECT name FROM data WHERE name LIKE 'A%'");
    assert.strictEqual(resLike.length, 1);
    assert.strictEqual(resLike[0].name, 'Alice');

    const resLikeSub = executeSql(dataMap, "SELECT name FROM data WHERE name LIKE '%li%'");
    assert.strictEqual(resLikeSub.length, 2); // Alice, Charlie

    const resIlike = executeSql(dataMap, "SELECT name FROM data WHERE name ILIKE 'alice'");
    assert.strictEqual(resIlike.length, 1);
    assert.strictEqual(resIlike[0].name, 'Alice');

    const resIn = executeSql(dataMap, "SELECT name FROM data WHERE status IN ('inactive', 'pending')");
    assert.strictEqual(resIn.length, 2);
    assert.deepStrictEqual(resIn.map(r => r.name), ['Bob', 'Evan']);

    const resNotIn = executeSql(dataMap, "SELECT name FROM data WHERE department NOT IN ('Engineering')");
    assert.strictEqual(resNotIn.length, 2);
    assert.deepStrictEqual(resNotIn.map(r => r.name), ['Charlie', 'Diana']);

    const resBetween = executeSql(dataMap, "SELECT name, age FROM data WHERE age BETWEEN 25 AND 35");
    assert.strictEqual(resBetween.length, 3);
    assert.deepStrictEqual(resBetween.map(r => r.name), ['Alice', 'Bob', 'Evan']);

    const resNull = executeSql(dataMap, "SELECT name FROM data WHERE profile.missing IS NULL");
    assert.strictEqual(resNull.length, 5);

    const resNotNull = executeSql(dataMap, "SELECT name FROM data WHERE profile.city IS NOT NULL");
    assert.strictEqual(resNotNull.length, 5);
  }

  console.log('  6. Aggregates without GROUP BY (COUNT, SUM, AVG, MIN, MAX)...');
  {
    const res = executeSql(dataMap, 'SELECT COUNT(*) AS total, SUM(salary) AS totalSalary, AVG(age) AS avgAge, MIN(salary) AS minSalary, MAX(salary) AS maxSalary FROM data');
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].total, 5);
    assert.strictEqual(res[0].totalSalary, 498000);
    assert.strictEqual(res[0].avgAge, 31.2);
    assert.strictEqual(res[0].minSalary, 75000);
    assert.strictEqual(res[0].maxSalary, 130000);
  }

  console.log('  7. GROUP BY and HAVING...');
  {
    const resGroup = executeSql(dataMap, 'SELECT department, COUNT(*) AS empCount, AVG(salary) AS avgSalary FROM data GROUP BY department ORDER BY empCount DESC');
    assert.strictEqual(resGroup.length, 3);
    assert.strictEqual(resGroup[0].department, 'Engineering');
    assert.strictEqual(resGroup[0].empCount, 3);
    assert.strictEqual(Math.round(resGroup[0].avgSalary), 97667);

    const resHaving = executeSql(dataMap, 'SELECT department, COUNT(*) AS empCount FROM data GROUP BY department HAVING COUNT(*) > 1');
    assert.strictEqual(resHaving.length, 1);
    assert.strictEqual(resHaving[0].department, 'Engineering');
  }

  console.log('  8. ORDER BY (ASC, DESC) and LIMIT / OFFSET...');
  {
    const resOrderDesc = executeSql(dataMap, 'SELECT name, salary FROM data ORDER BY salary DESC LIMIT 2');
    assert.strictEqual(resOrderDesc.length, 2);
    assert.strictEqual(resOrderDesc[0].name, 'Diana');
    assert.strictEqual(resOrderDesc[1].name, 'Bob');

    const resOffset = executeSql(dataMap, 'SELECT name, salary FROM data ORDER BY salary DESC LIMIT 2 OFFSET 1');
    assert.strictEqual(resOffset.length, 2);
    assert.strictEqual(resOffset[0].name, 'Bob');
    assert.strictEqual(resOffset[1].name, 'Alice');

    const resLimitComma = executeSql(dataMap, 'SELECT name FROM data ORDER BY id ASC LIMIT 1, 2');
    assert.strictEqual(resLimitComma.length, 2);
    assert.strictEqual(resLimitComma[0].name, 'Bob');
    assert.strictEqual(resLimitComma[1].name, 'Charlie');
  }

  console.log('  9. SELECT DISTINCT...');
  {
    const resDist = executeSql(dataMap, 'SELECT DISTINCT department FROM data ORDER BY department ASC');
    assert.strictEqual(resDist.length, 3);
    assert.deepStrictEqual(resDist.map(r => r.department), ['Design', 'Engineering', 'Product']);
  }

  console.log('  10. Multi-source JOINs (INNER and LEFT JOIN)...');
  {
    const resInner = executeSql(dataMap, 'SELECT u.name, o.orderId, o.amount, o.item FROM users u INNER JOIN orders o ON u.id = o.userId ORDER BY o.orderId ASC');
    assert.strictEqual(resInner.length, 4);
    assert.strictEqual(resInner[0].name, 'Alice');
    assert.strictEqual(resInner[0].orderId, 101);
    assert.strictEqual(resInner[0].amount, 250);
    assert.strictEqual(resInner[2].name, 'Bob');
    assert.strictEqual(resInner[2].orderId, 103);

    const resLeft = executeSql(dataMap, 'SELECT u.name, o.orderId, o.amount FROM users u LEFT JOIN orders o ON u.id = o.userId ORDER BY u.id ASC, o.orderId ASC');
    // Charlie (id 3) and Evan (id 5) have no orders and should have null orderId
    assert.strictEqual(resLeft.length, 6);
    const charlieRow = resLeft.find(r => r.name === 'Charlie');
    assert.ok(charlieRow);
    assert.strictEqual(charlieRow.orderId, null);
    assert.strictEqual(charlieRow.amount, null);
  }

  console.log('  11. Built-in SQL functions (UPPER, LOWER, CONCAT, ROUND, COALESCE, CASE)...');
  {
    const resFn = executeSql(dataMap, "SELECT UPPER(name) AS upperName, LOWER(department) AS lowerDept, CONCAT(name, ' (', department, ')') AS label, ROUND(salary / 1000, 1) AS kSalary FROM data WHERE id = 1");
    assert.strictEqual(resFn[0].upperName, 'ALICE');
    assert.strictEqual(resFn[0].lowerDept, 'engineering');
    assert.strictEqual(resFn[0].label, 'Alice (Engineering)');
    assert.strictEqual(resFn[0].kSalary, 95);

    const resCase = executeSql(dataMap, "SELECT name, CASE WHEN status = 'active' THEN 'OK' WHEN status = 'inactive' THEN 'DISABLED' ELSE 'OTHER' END AS statusLabel FROM data ORDER BY id ASC");
    assert.strictEqual(resCase[0].statusLabel, 'OK');
    assert.strictEqual(resCase[1].statusLabel, 'DISABLED');
    assert.strictEqual(resCase[4].statusLabel, 'OTHER');
  }

  console.log('  12. SQL Formatter (formatSql)...');
  {
    const rawSql = 'select id,name from users where id>10 and status="active" order by name desc limit 5';
    const formatted = formatSql(rawSql);
    assert.ok(formatted.includes('SELECT id,name'), 'SELECT should be uppercase');
    assert.ok(formatted.includes('FROM users'), 'FROM should be uppercase');
    assert.ok(formatted.includes('WHERE id>10'), 'WHERE should be uppercase');
    assert.ok(formatted.includes('ORDER BY name DESC'), 'ORDER BY should be uppercase');
    assert.ok(formatted.includes('LIMIT 5'), 'LIMIT should be uppercase');
  }

  console.log('  13. Syntax error handling...');
  {
    let caught = false;
    try {
      parseSql('SELECT FROM WHERE');
    } catch (err) {
      caught = true;
      assert.ok(err.message.includes('SQL syntax error'), 'Error message should contain SQL syntax error');
    }
    assert.ok(caught, 'Invalid query should throw syntax error');
  }

  console.log('  14. Querying nested arrays inside JSON objects...');
  {
    const objectDataMap = {
      data: {
        status: 'success',
        code: 200,
        users: [
          { id: 1, name: 'Alice', age: 30, department: 'Engineering' },
          { id: 2, name: 'Bob', age: 25, department: 'Marketing' }
        ],
        response: {
          items: [
            { sku: 'ITEM-1', qty: 10 },
            { sku: 'ITEM-2', qty: 2 }
          ]
        }
      }
    };

    // Test querying with FROM data.users
    const resDotted = executeSql(objectDataMap, 'SELECT u.name, u.age FROM data.users u WHERE u.age > 26');
    assert.strictEqual(resDotted.length, 1);
    assert.strictEqual(resDotted[0].name, 'Alice');

    // Test querying with FROM users (direct property fallback on root data object)
    const resFallback = executeSql(objectDataMap, 'SELECT name, age FROM users WHERE age < 28');
    assert.strictEqual(resFallback.length, 1);
    assert.strictEqual(resFallback[0].name, 'Bob');

    // Test deeply nested array FROM data.response.items
    const resDeepDotted = executeSql(objectDataMap, 'SELECT i.sku, i.qty FROM data.response.items i WHERE i.qty > 5');
    assert.strictEqual(resDeepDotted.length, 1);
    assert.strictEqual(resDeepDotted[0].sku, 'ITEM-1');

    // Test deeply nested array FROM response.items
    const resDeepFallback = executeSql(objectDataMap, 'SELECT i.sku FROM response.items i WHERE i.qty <= 5');
    assert.strictEqual(resDeepFallback.length, 1);
    assert.strictEqual(resDeepFallback[0].sku, 'ITEM-2');
  }

  console.log('\n✅ All SQL Engine tests passed successfully!');
}

runSqlEngineTests().catch((err) => {
  console.error('\n❌ SQL Engine test failure:', err);
  process.exit(1);
});
