/**
 * 限制数值范围
 * @param {number} val - 默认数值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 */
export const clampedMum = (val: number, min: number, max: number) =>
  z.coerce
    .number()
    .prefault(val)
    .transform(val => _.clamp(val, min, max));

/**
 * 数字取整并限制最小值
 * @param {number} val - 默认数值
 * @param {number} min - 最小值
 */
export const minLimitedNum = (val: number, min: number) =>
  z.coerce
    .number()
    .prefault(val)
    .transform(val => Math.max(Math.round(val), min));

/**
 * 资源值 schema（生命值/法力值/体力值）
 * - 当前: 不可超过 上限._基础 + 上限.额外
 * - 上限._基础: 只读，仅随等级/属性/层级重算
 * - 上限.额外: 可变，装备/状态/临时增益写这里
 */
export const ResourceSchema = z
  .object({
    当前: z.coerce.number().prefault(0),
    上限: z
      .object({
        _基础: z.coerce.number().prefault(0),
        额外: z.coerce.number().prefault(0),
      })
      .prefault({}),
  })
  .prefault({})
  .transform(data => ({
    ...data,
    当前: _.clamp(data.当前, 0, Math.max(0, data.上限._基础 + data.上限.额外)),
  }));

/** 旧版"分开的数字"资源字段 → 新版嵌套结构的对应关系 */
const LegacyResourcePairs: ReadonlyArray<readonly [string, string]> = [
  ['生命值', '生命值上限'],
  ['法力值', '法力值上限'],
  ['体力值', '体力值上限'],
];

/** 把值解析为有限数字，失败返回 null */
const toFiniteNumberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * 旧存档兼容迁移：把旧版数字式资源字段转换为新版嵌套结构
 *   旧：生命值: 85, 生命值上限: 100
 *   新：生命值: { 当前: 85, 上限: { _基础: 100, 额外: 0 } }
 * 已经是新结构的对象 / 缺失该字段时原样返回。
 * 注意：上限._基础 会由脚本按属性重算，这里只保证"当前值"不丢。
 */
export const migrateLegacyResources = (data: unknown): unknown => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;

  const source = data as Record<string, unknown>;
  const hasLegacyField = LegacyResourcePairs.some(
    ([current_key]) => toFiniteNumberOrNull(source[current_key]) !== null
  );
  if (!hasLegacyField) return data;

  const next: Record<string, unknown> = { ...source };
  for (const [current_key, max_key] of LegacyResourcePairs) {
    const current_value = toFiniteNumberOrNull(next[current_key]);
    if (current_value === null) continue;

    const max_value = toFiniteNumberOrNull(next[max_key]) ?? current_value;
    next[current_key] = { 当前: current_value, 上限: { _基础: max_value, 额外: 0 } };
    delete next[max_key];
  }

  return next;
};

/** 对「关系列表」这类 { 名称: 伙伴对象 } 的映射逐个应用资源字段迁移 */
export const migrateLegacyPartnerMap = (data: unknown): unknown => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;

  const map = data as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;

  for (const [name, partner] of Object.entries(map)) {
    const migrated = migrateLegacyResources(partner);
    if (migrated !== partner) {
      if (!next) next = { ...map };
      next[name] = migrated;
    }
  }

  return next ?? data;
};

/**
 * 截取 record 的前 n 个条目
 * @param {Record<string, T>} record - 待截取的 record
 * @param {number} limit - 限制的条目数
 */
const sliceRecord = <T>(record: Record<string, T>, limit: number): Record<string, T> =>
  _.fromPairs(_.take(_.toPairs(record), limit));

/**
 * 任务 schema
 */
export const TaskSchema = z
  .object({
    状态: z.string().prefault(''),
    关注度: z.enum(['低', '中', '高']).prefault('中'),
    进展: z.string().prefault(''),
    详情: z.string().prefault(''),
    目标: z.string().prefault(''),
    奖励: z.string().prefault(''),
  })
  .prefault({});

/**
 * 基础物品 schema
 */
export const BaseItemSchema = z.object({
  品质: z.string().prefault(''),
  类型: z.string().prefault(''),
  标签: z
    .array(z.string())
    .prefault([])
    .transform(arr => _.uniq(arr))
    .optional(),
  效果: z.record(z.string(), z.string()).prefault({}),
  描述: z.string().prefault(''),
});

/**
 * 装备schema
 */
export const EquipmentSchema = BaseItemSchema.extend({
  位置: z.string().prefault(''),
});

/**
 * 技能 schema
 */
export const SkillSchema = BaseItemSchema.extend({
  消耗: z.string().prefault(''),
  _隐藏: z.boolean().prefault(false),
}).transform(data => _.pick(data, ['品质', '类型', '消耗', '标签', '效果', '描述', '_隐藏']));

/**
 * 状态效果 schema (增益/减益/特殊效果)
 */
export const StatusEffectSchema = z
  .object({
    类型: z.enum(['增益', '减益', '特殊']).prefault('增益'),
    效果: z.string().prefault(''),
    层数: z.coerce.number().prefault(1),
    剩余时间: z.string().prefault(''),
    来源: z.string().prefault(''),
  })
  .prefault({});

/**
 * 背包物品 schema
 */
export const InventoryItemSchema = BaseItemSchema.extend({
  数量: z.coerce.number().prefault(1),
  _隐藏: z.boolean().prefault(false),
}).transform(data => _.pick(data, ['品质', '类型', '数量', '标签', '效果', '描述', '_隐藏']));

/**
 * 基础属性 schema
 */
const DefaultAttr = {
  力量: 0,
  敏捷: 0,
  体质: 0,
  智力: 0,
  精神: 0,
} as const;

export const BaseAttrSchema = z
  .object(_.mapValues(DefaultAttr, () => z.coerce.number().prefault(0)))
  .prefault({});

/**
 * 登神长阶 schema
 *
 * 状态约束：
 * - 有法则时：权能和要素清空，不可再获得
 * - 有权能时：要素清空，不可再获得
 * - 正常情况（无权能 且 无法则）：可收集要素（最多3个）
 */
export const AscensionSchema = z
  .object({
    是否开启: z.boolean().prefault(false),
    要素: z.record(z.string(), z.record(z.string(), z.string())).prefault({}),
    权能: z.record(z.string(), z.record(z.string(), z.string())).prefault({}),
    法则: z.record(z.string(), z.record(z.string(), z.string())).prefault({}),
    神位: z.string().prefault(''),
    神国: z
      .object({
        名称: z.string().prefault(''),
        描述: z.string().prefault(''),
      })
      .prefault({}),
  })
  .prefault({})
  .transform(data => {
    const lawNum = _.size(data.法则);
    const powerNum = _.size(data.权能);
    const powerLimit = 1;
    const eleLimit = 3;
    const lawLimit = data.神国?.名称 ? Number.POSITIVE_INFINITY : data.神位 ? 2 : 1;

    // 有法则：权能和要素永久清空
    if (lawNum > 0) {
      return {
        ...data,
        要素: {},
        权能: {},
        法则: sliceRecord(data.法则, lawLimit),
      };
    }

    // 有权能：要素清空
    if (powerNum > 0) {
      return {
        ...data,
        要素: {},
        权能: sliceRecord(data.权能, powerLimit),
        法则: sliceRecord(data.法则, lawLimit),
      };
    }

    // 无权能且无法则：正常收集要素
    return {
      ...data,
      要素: sliceRecord(data.要素, eleLimit),
      权能: sliceRecord(data.权能, powerLimit),
      法则: {},
    };
  });

/**
 * 通用角色身份信息 schema
 */
export const IdentitySchema = z.object({
  等级: clampedMum(1, 1, 25),
  生命层级: z.string().prefault(''),
  种族: z.string().prefault(''),
  身份: z
    .array(z.string())
    .prefault([])
    .transform(arr => _.uniq(arr)),
  职业: z
    .array(z.string())
    .prefault([])
    .transform(arr => _.uniq(arr)),
  属性: BaseAttrSchema,
  装备: z.record(z.string(), EquipmentSchema).prefault({}),
  技能: z.record(z.string(), SkillSchema).prefault({}),
  登神长阶: AscensionSchema,
});
