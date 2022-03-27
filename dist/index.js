"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.load = void 0;
const convert_source_map_1 = require("convert-source-map");
const path_1 = __importDefault(require("path"));
const typedoc_1 = require("typedoc");
function load(app) {
    app.converter.on(typedoc_1.Converter.EVENT_RESOLVE, visitReflection);
}
exports.load = load;
function visitReflection(context, reflection) {
    if (!isTypedReflection(reflection))
        return;
    const reflectionType = reflection.type;
    if (!reflectionType)
        return;
    const visitor = makeRecursiveMutatingVisitor({
        reference(type) {
            return fixType(context, type);
        },
    });
    reflection.type = (visitor[reflectionType.type]?.(reflectionType) ?? reflectionType);
}
function makeRecursiveMutatingVisitor(visitor) {
    // visit a Type member
    const memberVisit = (type, memberName) => {
        const innerType = type[memberName];
        if (innerType) {
            type[memberName] = (recursiveVisitor[innerType.type]?.(innerType) ?? innerType);
        }
    };
    // visit a Type[] member
    const membersVisit = (type, memberName) => {
        const innerTypes = type[memberName];
        innerTypes?.forEach((innerType, i) => {
            if (innerType) {
                innerTypes[i] = (recursiveVisitor[innerType.type]?.(innerType) ?? innerTypes[i]);
            }
        });
    };
    const recursiveVisitor = {
        'named-tuple-member'(type) {
            const mutated = visitor['named-tuple-member']?.(type) ?? type;
            memberVisit(mutated, 'element');
            return mutated;
        },
        'template-literal'(type) {
            const mutated = visitor['template-literal']?.(type) ?? type;
            mutated.tail.forEach(([innerType], i) => {
                mutated.tail[i][0] =
                    recursiveVisitor[mutated.tail[i][0].type]?.(mutated.tail[i][0]) ?? mutated.tail[i][0];
            });
            return mutated;
        },
        array(type) {
            const mutated = visitor.array?.(type) ?? type;
            memberVisit(mutated, 'elementType');
            return mutated;
        },
        conditional(type) {
            const mutated = visitor.conditional?.(type) ?? type;
            memberVisit(mutated, 'checkType');
            memberVisit(mutated, 'extendsType');
            memberVisit(mutated, 'trueType');
            memberVisit(mutated, 'falseType');
            return mutated;
        },
        indexedAccess(type) {
            const mutated = visitor.indexedAccess?.(type) ?? type;
            memberVisit(mutated, 'indexType');
            memberVisit(mutated, 'objectType');
            return mutated;
        },
        inferred(type) {
            return visitor.inferred?.(type) ?? type;
        },
        intersection(type) {
            const mutated = visitor.intersection?.(type) ?? type;
            membersVisit(mutated, 'types');
            return mutated;
        },
        intrinsic(type) {
            return visitor.intrinsic?.(type) ?? type;
        },
        literal(type) {
            return visitor.literal?.(type) ?? type;
        },
        mapped(type) {
            const mutated = visitor.mapped?.(type) ?? type;
            memberVisit(mutated, 'nameType');
            memberVisit(mutated, 'parameterType');
            memberVisit(mutated, 'templateType');
            return mutated;
        },
        optional(type) {
            const mutated = visitor.optional?.(type) ?? type;
            memberVisit(mutated, 'elementType');
            return mutated;
        },
        predicate(type) {
            const mutated = visitor.predicate?.(type) ?? type;
            memberVisit(mutated, 'targetType');
            return mutated;
        },
        query(type) {
            const mutated = visitor.query?.(type) ?? type;
            memberVisit(mutated, 'queryType');
            return mutated;
        },
        reference(type) {
            const mutated = visitor.reference?.(type) ?? type;
            membersVisit(mutated, 'typeArguments');
            return mutated;
        },
        reflection(type) {
            const mutated = visitor.reflection?.(type) ?? type;
            // Note: The below comment is from the original typedoc visitor function
            // Future: This should maybe recurse too?
            // See the validator in exports.ts for how to do it.
            return mutated;
        },
        rest(type) {
            const mutated = visitor.rest?.(type) ?? type;
            memberVisit(mutated, 'elementType');
            return mutated;
        },
        tuple(type) {
            const mutated = visitor.tuple?.(type) ?? type;
            membersVisit(mutated, 'elements');
            return mutated;
        },
        typeOperator(type) {
            const mutated = visitor.typeOperator?.(type) ?? type;
            memberVisit(mutated, 'target');
            return mutated;
        },
        union(type) {
            const mutated = visitor.union?.(type) ?? type;
            membersVisit(mutated, 'types');
            return mutated;
        },
        unknown(type) {
            return visitor.unknown?.(type) ?? type;
        },
    };
    return recursiveVisitor;
}
function fixType(context, type) {
    if (!isReferenceTypeBroken(type))
        return type;
    return getSourcesReferenceType(type, context.project) ?? type;
}
function getSourcesReferenceType(type, project) {
    const srcFile = findSymbolSourceFile(type.getSymbol(), project);
    if (!srcFile)
        return null;
    const newTargetReflection = srcFile.reflections.find(({ name }) => name === type.name);
    if (!newTargetReflection)
        return null;
    const newTargetSymbol = project.getSymbolFromReflection(newTargetReflection);
    if (!newTargetSymbol)
        return null;
    return new typedoc_1.ReferenceType(type.name, newTargetSymbol, project);
}
function findSymbolSourceFile(symbol, project) {
    const declarations = symbol.getDeclarations();
    if (!declarations)
        return undefined;
    for (const declaration of declarations) {
        const declSrcFile = declaration.getSourceFile();
        const declSrcFileName = declSrcFile.fileName;
        // Find without using source maps
        const directSrcFile = project.files.find(({ fullFileName }) => fullFileName === declSrcFileName);
        if (directSrcFile)
            return directSrcFile;
        // Find using source map
        const srcDirPath = path_1.default.dirname(declSrcFileName);
        const srcMapConverter = (0, convert_source_map_1.fromSource)(declSrcFile.text) ?? (0, convert_source_map_1.fromMapFileSource)(declSrcFile.text, srcDirPath);
        if (!srcMapConverter)
            continue;
        const sources = srcMapConverter.toObject().sources;
        for (const source of sources) {
            const srcFileName = path_1.default.normalize(path_1.default.resolve(srcDirPath, source));
            const srcFile = project.files.find(({ fullFileName }) => path_1.default.normalize(fullFileName) === srcFileName);
            if (!srcFile)
                continue;
            return srcFile;
        }
    }
    return undefined;
}
function isReferenceTypeBroken(type) {
    return type.reflection == null && type.getSymbol() != null;
}
function isTypedReflection(reflection) {
    return (reflection instanceof typedoc_1.DeclarationReflection ||
        reflection instanceof typedoc_1.SignatureReflection ||
        reflection instanceof typedoc_1.ParameterReflection ||
        reflection instanceof typedoc_1.TypeParameterReflection);
}
