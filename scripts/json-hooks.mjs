// 为无属性的 .json 导入补 type: json（源码按 Vite 约定裸导入 JSON）
export async function resolve(specifier, context, next) {
    if (specifier.endsWith('.json')) {
        const result = await next(specifier, context);
        return { ...result, importAttributes: { type: 'json' }, shortCircuit: true };
    }
    return next(specifier, context);
}
