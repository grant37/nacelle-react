const { ensureDir } = require('fs-extra');
const { print } = require('gatsby/graphql');
const {
  sourceAllNodes,
  createSchemaCustomization,
  compileNodeQueries,
  readOrGenerateDefaultFragments,
  buildNodeDefinitions,
  loadSchema,
  createDefaultQueryExecutor
} = require('gatsby-graphql-source-toolkit');
const { getNacelleVariables } = require('../utils');

module.exports = async function (gatsbyApi, pluginOptions, nodeConfig) {
  const nacelleOptions = getNacelleVariables(pluginOptions);
  const CHUNK_SIZE = 100;
  const fragmentsDir = process.cwd() + `/gql-fragments`;

  const PaginateNacelle = {
    name: 'NacellePagination',
    expectedVariableNames: ['first', 'after'],
    start() {
      return {
        variables: { first: CHUNK_SIZE, after: undefined },
        hasNextPage: true
      };
    },
    next(state, page) {
      return {
        variables: { first: CHUNK_SIZE, after: page.nextToken },
        hasNextPage: Boolean(page.nextToken && page.items.length === CHUNK_SIZE)
      };
    },
    concat(acc, page) {
      return {
        ...acc,
        items: {
          ...acc.items,
          ...page.items
        },
        nextToken: page.nextToken
      };
    },
    getItems(pageOrResult) {
      return pageOrResult.items;
    }
  };

  async function createSourcingConfig(
    gatsbyApi,
    pluginOptions,
    nacelleOptions
  ) {
    const { verbose } = pluginOptions;

    // Set up remote schema:
    const defaultExecute = createDefaultQueryExecutor(
      'https://hailfrequency.com/v2/graphql',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-nacelle-space-id': nacelleOptions.nacelleSpaceId,
          'x-nacelle-space-token': nacelleOptions.nacelleGraphqlToken
        }
      }
    );

    const execute = (args) => {
      if (verbose) {
        console.log(args.operationName, args.variables);
      }

      return defaultExecute(args);
    };

    const schema = await loadSchema(execute);

    // Configure Gatsby node types
    // Note:
    //  Queries with LIST_ prefix are automatically executed in sourceAllNodes
    //  Queries with NODE_ prefix are executed in sourceNodeChanges for updated nodes
    const gatsbyNodeTypes = [
      {
        remoteTypeName: 'Product',
        queries: `
        query LIST_PRODUCTS {
          getProducts(first: $first, after: $after) {
            nextToken
            items { ..._ProductId_ }
          }
        }
        query NODE_PRODUCT {
          getProductByHandle(handle: $handle, locale: $locale) {
            ..._ProductId_
          }
        }
        fragment _ProductId_ on Product { __typename handle locale }
      `
      },
      {
        remoteTypeName: 'Collection',
        queries: `
        query LIST_COLLECTION {
          getCollections(first: $first, after: $after) {
            nextToken
            items { ..._CollectionId_ }
          }
        }
        query NODE_COLLECTION {
          getCollectionByHandle(handle: $handle, locale: $locale) {
            ..._CollectionId_
          }
        }
        fragment _CollectionId_ on Collection { __typename handle locale }
      `
      },
      {
        remoteTypeName: 'Content',
        queries: `
        query LIST_CONTENT {
          getContent(first: $first, after: $after) {
            nextToken
            items { ..._ContentId_ }
          }
        }
        query NODE_CONTENT {
          getContentByHandle(
            type: $type
            handle: $handle
            locale: $locale
          ) {
            ..._ContentId_
          }
        }
        fragment _ContentId_ on Content {
          __typename
          type
          handle
          locale
        }
      `
      },
      {
        remoteTypeName: 'Space',
        queries: `
        query NODE_SPACE {
          getSpace {
            ..._SpaceId_
          }
        }
        fragment _SpaceId_ on Space { __typename id }
      `
      }
    ];

    const gatsbyNodeTypesLessContent = gatsbyNodeTypes.filter(
      (nodeType) => nodeType.remoteTypeName !== 'Content'
    );

    function getNodeTypes() {
      return nacelleOptions.cmsPreview
        ? gatsbyNodeTypesLessContent
        : gatsbyNodeTypes;
    }

    // Provide (or generate) fragments with fields to be fetched
    ensureDir(fragmentsDir);
    const fragments = await readOrGenerateDefaultFragments(fragmentsDir, {
      schema,
      gatsbyNodeTypes: getNodeTypes()
    });

    // Compile sourcing queries
    const documents = compileNodeQueries({
      schema,
      gatsbyNodeTypes: getNodeTypes(),
      customFragments: fragments
    });

    return {
      gatsbyApi,
      schema,
      execute,
      gatsbyTypePrefix: nodeConfig.nodePrefix,
      gatsbyNodeDefs: buildNodeDefinitions({
        gatsbyNodeTypes: getNodeTypes(),
        documents
      }),
      paginationAdapters: [PaginateNacelle]
    };
  }

  async function sourceSpaceNode(config) {
    const remoteTypeName = 'Space';
    const document = config.gatsbyNodeDefs.get(remoteTypeName).document;
    const result = await config.execute({
      query: print(document),
      operationName: `NODE_SPACE`,
      variables: {}
    });

    await config.gatsbyApi.actions.createNode({
      id: `${remoteTypeName}${result.data.getSpace.remoteId}`,
      ...result.data.getSpace,
      internal: {
        type: `${config.gatsbyTypePrefix}${remoteTypeName}`,
        contentDigest: config.gatsbyApi.createContentDigest(
          result.data.getSpace
        )
      }
    });
  }

  const sourcingConfig = await createSourcingConfig(
    gatsbyApi,
    pluginOptions,
    nacelleOptions
  );

  // Add explicit types to gatsby schema
  await createSchemaCustomization(sourcingConfig);

  // Source nodes
  await sourceAllNodes(sourcingConfig);

  // Source the Space node manually (as it is not sourced automatically yet):
  await sourceSpaceNode(sourcingConfig);
};
