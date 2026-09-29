const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');

async function runTests() {
  console.log('Testing Multi-Language Type & Contract Generator...');

  // Bundle src/typeGen.ts and src/export.ts in memory
  const result = await esbuild.build({
    entryPoints: [
      path.join(__dirname, '../src/typeGen.ts'),
      path.join(__dirname, '../src/export.ts')
    ],
    bundle: true,
    platform: 'node',
    outdir: 'out_test_typegen',
    write: false,
    format: 'cjs'
  });

  const typeGenFile = result.outputFiles.find(f => f.path.endsWith('typeGen.js'));
  const exportFile = result.outputFiles.find(f => f.path.endsWith('export.js'));

  if (!typeGenFile) {
    throw new Error('Failed to bundle typeGen.ts');
  }

  const typeGenMod = { exports: {} };
  const fn1 = new Function('module', 'exports', 'require', '__dirname', typeGenFile.text);
  fn1(typeGenMod, typeGenMod.exports, require, __dirname);

  const {
    toPascalCase,
    toSnakeCase,
    singularizeName,
    isPythonKeyword,
    isValidJsIdentifier,
    generateTypeScript,
    generateZodSchema,
    generateJsonSchema,
    generatePydantic,
    generatePythonDataclass,
    generateContract
  } = typeGenMod.exports;

  // 1. String Utilities
  console.log('  1. Testing string utility functions...');
  assert.strictEqual(toPascalCase('user_profile'), 'UserProfile');
  assert.strictEqual(toPascalCase('order-details'), 'OrderDetails');
  assert.strictEqual(toPascalCase('123items'), 'Model123items');
  assert.strictEqual(toPascalCase(''), 'Model');

  assert.strictEqual(toSnakeCase('userId'), 'user_id');
  assert.strictEqual(toSnakeCase('UserProfile'), 'user_profile');
  assert.strictEqual(toSnakeCase('content-type'), 'content_type');
  assert.strictEqual(toSnakeCase('123'), '_123');

  assert.strictEqual(singularizeName('users'), 'user');
  assert.strictEqual(singularizeName('addresses'), 'address');
  assert.strictEqual(singularizeName('categories'), 'category');
  assert.strictEqual(singularizeName('status'), 'status');

  assert.strictEqual(isPythonKeyword('def'), true);
  assert.strictEqual(isPythonKeyword('class'), true);
  assert.strictEqual(isPythonKeyword('from'), true);
  assert.strictEqual(isPythonKeyword('username'), false);

  assert.strictEqual(isValidJsIdentifier('foo'), true);
  assert.strictEqual(isValidJsIdentifier('user_name'), true);
  assert.strictEqual(isValidJsIdentifier('$var1'), true);
  assert.strictEqual(isValidJsIdentifier('first-name'), false);
  assert.strictEqual(isValidJsIdentifier('123abc'), false);
  console.log('    ✓ String utilities pass');

  // Sample Data Models
  const flatUser = {
    id: 1,
    name: 'Alice',
    active: true,
    score: 98.5
  };

  const nestedUser = {
    id: 101,
    username: 'bob123',
    address: {
      street: '123 Main St',
      city: 'Metropolis',
      zipCode: '10001'
    },
    tags: ['admin', 'staff'],
    metadata: null
  };

  const usersArray = [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', age: 30 }
  ];

  // 2. TypeScript Generator Tests
  console.log('  2. Testing TypeScript Generator...');
  const tsFlat = generateTypeScript(flatUser, { rootName: 'User' });
  assert(tsFlat.includes('export interface User {'), 'Should declare export interface User');
  assert(tsFlat.includes('id: number;'), 'id should be number');
  assert(tsFlat.includes('name: string;'), 'name should be string');
  assert(tsFlat.includes('active: boolean;'), 'active should be boolean');
  assert(tsFlat.includes('score: number;'), 'score should be number');

  const tsNested = generateTypeScript(nestedUser, { rootName: 'UserAccount' });
  assert(tsNested.includes('interface Address {') || tsNested.includes('interface UserAccountAddress {'), 'Should extract nested interface');
  assert(tsNested.includes('address: Address;') || tsNested.includes('address: UserAccountAddress;'), 'Should reference extracted interface');
  assert(tsNested.includes('tags: string[];'), 'Should format array type');
  assert(tsNested.includes('metadata: null;'), 'Should format null type');

  const tsArray = generateTypeScript(usersArray, { rootName: 'Users' });
  assert(tsArray.includes('interface UserItem {'), 'Should derive array item model');
  assert(tsArray.includes('email?: string;'), 'Optional email field');
  assert(tsArray.includes('age?: number;'), 'Optional age field');
  assert(tsArray.includes('export type Users = UserItem[];'), 'Root should be alias to array of items');

  // Test deduplication of nested objects across array items
  const packageItems = [
    { id: 1, package_type_id: { name: 'standard' } },
    { id: 2, package_type_id: { name: 'express' } },
    { id: 3, package_type_id: { name: 'overnight' } }
  ];
  const tsPackages = generateTypeScript(packageItems, { rootName: 'Packages' });
  assert(tsPackages.includes('interface PackageTypeId {'), 'Should generate single PackageTypeId');
  assert(!tsPackages.includes('PackageTypeId1'), 'Should not have PackageTypeId1');
  assert(!tsPackages.includes('PackageTypeId2'), 'Should not have PackageTypeId2');
  assert(tsPackages.includes('package_type_id: PackageTypeId;'), 'Property should reference single PackageTypeId');

  const tsTypeAlias = generateTypeScript(flatUser, { rootName: 'User', useInterface: false, exportKeyword: false });
  assert(tsTypeAlias.includes('type User = {'), 'Should support type alias mode without export');
  console.log('    ✓ TypeScript generator passes');

  // 3. Zod Schema Generator Tests
  console.log('  3. Testing Zod Schema Generator...');
  const zodNested = generateZodSchema(nestedUser, { rootName: 'UserAccount' });
  assert(zodNested.includes('import { z } from "zod";'), 'Should import zod');
  assert(zodNested.includes('AddressSchema = z.object({'), 'Child schema declared');
  assert(zodNested.includes('export const UserAccountSchema = z.object({'), 'Parent schema declared');
  assert(zodNested.includes('address: AddressSchema,'), 'References child schema');
  assert(zodNested.includes('tags: z.array(z.string()),'), 'Array of strings');
  assert(zodNested.includes('export type UserAccount = z.infer<typeof UserAccountSchema>;'), 'Infers static type');

  const zodArray = generateZodSchema(usersArray, { rootName: 'UserList' });
  assert(zodArray.includes('email: z.string().optional(),'), 'Optional field has .optional()');
  assert(zodArray.includes('export const UserListSchema = z.array(UserListItemSchema);'), 'Root array schema');
  console.log('    ✓ Zod generator passes');

  // 4. JSON Schema Generator Tests
  console.log('  4. Testing JSON Schema Generator...');
  const jsonSchemaRaw = generateJsonSchema(nestedUser, { rootName: 'Account' });
  const jsonSchema = JSON.parse(jsonSchemaRaw);
  assert.strictEqual(jsonSchema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.strictEqual(jsonSchema.title, 'Account');
  assert.strictEqual(jsonSchema.type, 'object');
  assert.strictEqual(jsonSchema.properties.id.type, 'integer');
  assert.strictEqual(jsonSchema.properties.address.type, 'object');
  assert.strictEqual(jsonSchema.properties.tags.type, 'array');
  assert.strictEqual(jsonSchema.properties.tags.items.type, 'string');
  assert(Array.isArray(jsonSchema.required), 'Should have required array');
  assert(jsonSchema.required.includes('username'), 'username should be required');

  const jsonSchemaArray = JSON.parse(generateJsonSchema(usersArray, { rootName: 'Users' }));
  assert.strictEqual(jsonSchemaArray.type, 'array');
  assert.strictEqual(jsonSchemaArray.items.type, 'object');
  assert(jsonSchemaArray.items.required.includes('id'));
  assert(!jsonSchemaArray.items.required.includes('email'), 'email is optional across array items');
  console.log('    ✓ JSON Schema generator passes');

  // 5. Python Pydantic (v2) Generator Tests
  console.log('  5. Testing Python Pydantic (v2) Generator...');
  const pydanticObj = {
    id: 1,
    from: 'support@example.com',
    type: 'admin',
    userName: 'alice',
    isSuperuser: true,
    scoreRatio: 4.25,
    emptyNote: null
  };
  const pyCode = generatePydantic(pydanticObj, { rootName: 'Account', useSnakeCase: true });
  assert(pyCode.includes('from pydantic import BaseModel, Field'), 'Should import BaseModel and Field');
  assert(pyCode.includes('class Account(BaseModel):'), 'Model class declared');
  assert(pyCode.includes('id_: int = Field(alias="id")'), 'Python keyword "id" aliased');
  assert(pyCode.includes('from_: str = Field(alias="from")'), 'Python keyword "from" aliased');
  assert(pyCode.includes('type_: str = Field(alias="type")'), 'Python keyword "type" aliased');
  assert(pyCode.includes('user_name: str = Field(alias="userName")'), 'camelCase aliased to snake_case');
  assert(pyCode.includes('is_superuser: bool = Field(alias="isSuperuser")'), 'bool type mapping');
  assert(pyCode.includes('score_ratio: float = Field(alias="scoreRatio")'), 'float type mapping');

  const pyNested = generatePydantic(nestedUser, { rootName: 'User' });
  const pyHasAddress = pyNested.includes('class Address(BaseModel):') || pyNested.includes('class UserAddress(BaseModel):');
  assert(pyHasAddress, 'Should declare child model');
  assert(pyNested.includes('address: Address') || pyNested.includes('address: UserAddress'), 'Parent should reference child model');
  const pyAddrIdx = pyNested.indexOf('class Address(BaseModel):') !== -1 ? pyNested.indexOf('class Address(BaseModel):') : pyNested.indexOf('class UserAddress(BaseModel):');
  assert(pyAddrIdx < pyNested.indexOf('class User(BaseModel):'), 'Topological sort order');
  console.log('    ✓ Python Pydantic generator passes');

  // 6. Python Dataclass Generator Tests
  console.log('  6. Testing Python Dataclass Generator...');
  const dataclassCode = generatePythonDataclass(nestedUser, { rootName: 'User' });
  assert(dataclassCode.includes('@dataclass'), 'Should use @dataclass decorator');
  const dcHasAddress = dataclassCode.includes('class Address:') || dataclassCode.includes('class UserAddress:');
  assert(dcHasAddress, 'Should declare child dataclass');
  assert(dataclassCode.includes('class User:'), 'Should declare root dataclass');
  const dcAddrIdx = dataclassCode.indexOf('class Address:') !== -1 ? dataclassCode.indexOf('class Address:') : dataclassCode.indexOf('class UserAddress:');
  assert(dcAddrIdx < dataclassCode.indexOf('class User:'), 'Topological order');

  // Verify non-default argument ordering:
  // In Python, fields without defaults must appear BEFORE fields with default `= None`!
  const mixedFields = {
    optionalField: null,
    requiredField: 'hello',
    anotherOptional: undefined,
    id: 123
  };
  const sortedDataclass = generatePythonDataclass(mixedFields, { rootName: 'Mixed' });
  const lines = sortedDataclass.split('\n').filter(l => l.startsWith('    '));
  let seenDefault = false;
  for (const line of lines) {
    if (line.includes('= None')) {
      seenDefault = true;
    } else {
      assert(!seenDefault, `Non-default field found after default field: ${line}`);
    }
  }
  console.log('    ✓ Python Dataclass generator passes');

  // 7. Universal Dispatcher & Export Integration
  console.log('  7. Testing Universal Dispatcher & Export Integration...');
  const tsOut = generateContract(flatUser, 'typescript');
  assert(tsOut.includes('interface Root'));

  const zodOut = generateContract(flatUser, 'zod');
  assert(zodOut.includes('RootSchema = z.object'));

  const jsonOut = generateContract(flatUser, 'json-schema');
  assert(JSON.parse(jsonOut).$schema);

  const pyOut = generateContract(flatUser, 'pydantic');
  assert(pyOut.includes('BaseModel'));

  const dcOut = generateContract(flatUser, 'dataclass');
  assert(dcOut.includes('@dataclass'));

  if (exportFile) {
    const exportMod = { exports: {} };
    const fn2 = new Function('module', 'exports', 'require', '__dirname', exportFile.text);
    fn2(exportMod, exportMod.exports, require, __dirname);

    const { formatData, getFileExtension, getLanguageId, getFormatFilters } = exportMod.exports;

    assert.strictEqual(getFileExtension('typescript'), '.ts');
    assert.strictEqual(getFileExtension('zod'), '.ts');
    assert.strictEqual(getFileExtension('json-schema'), '.schema.json');
    assert.strictEqual(getFileExtension('pydantic'), '.py');
    assert.strictEqual(getFileExtension('dataclass'), '.py');

    assert.strictEqual(getLanguageId('typescript'), 'typescript');
    assert.strictEqual(getLanguageId('zod'), 'typescript');
    assert.strictEqual(getLanguageId('json-schema'), 'json');
    assert.strictEqual(getLanguageId('pydantic'), 'python');
    assert.strictEqual(getLanguageId('dataclass'), 'python');

    assert.deepStrictEqual(getFormatFilters('typescript'), { 'TypeScript': ['ts'] });
    assert.deepStrictEqual(getFormatFilters('pydantic'), { 'Python': ['py'] });
    assert.deepStrictEqual(getFormatFilters('json-schema'), { 'JSON Schema': ['json'] });

    const formattedTs = formatData(flatUser, 'typescript', { rootName: 'CustomUser' });
    assert(formattedTs.includes('interface CustomUser'));
  }
  console.log('    ✓ Export integration passes');

  console.log('\n✅ All Type & Contract Generator tests passed successfully!\n');
}

runTests().catch(err => {
  console.error('\n❌ Type Generator test failed:', err);
  process.exit(1);
});
