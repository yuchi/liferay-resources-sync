
import { resolve } from 'path';
import { writeFileSync } from 'fs';
import liferay from 'liferay-connector';
import mkdirp from 'mkdirp';
import program from 'commander';
import slug from 'slug';

import { ANT_LIFERAY_LOOK_AND_FEEL } from './constants';
import searchPath from './search-path';

import pkg from '../package';

const { Promise } = liferay;
const { coroutine, map } = Promise;

const classNames = [
  "com.liferay.portal.model.LayoutSet",
  "com.liferay.portlet.asset.model.AssetCategory",
  "com.liferay.portlet.asset.model.AssetEntry",
  "com.liferay.portlet.dynamicdatamapping.model.DDMStructure",
  "com.liferay.portlet.journal.model.JournalArticle"
];

const humanClassNames = classNames.reduce((memo, className) => {
  const split = className.split('.');
  memo[className] = split[split.length - 1];
  return memo;
}, {});

program
  .option('-h, --host <host>', 'host to connect to')
  .option('-u, --user <login>', 'the login to use')
  .option('-p, --pass <password>', 'the password to use')
  .version(pkg.version);

program
  .command('help')
  .description('output usage information')
  .action(() => program.help());

program
  .command('download')
  .description('downloads stuff')
  .action((options) => {
    const themeDir = searchPath(process.cwd(), ANT_LIFERAY_LOOK_AND_FEEL);
    const { host, user, pass } = options.parent;

    if (!themeDir) {
      console.error("No theme found here. Place yourself inside one.");
      return;
    }

    const templatesDir = resolve(themeDir, 'docroot', '_diffs', 'resources');

    mkdirp(templatesDir);

    coroutine(function * () {

      const session = yield liferay.v62.authenticate(host, {
        login: user,
        password : pass
      });

      const CLASS_NAME_CACHE = {};
      const getClassNameId = (className) => (
        CLASS_NAME_CACHE[className] || (
          CLASS_NAME_CACHE[className] = session.invoke({
              "/classname/fetch-class-name-id": { value: className }
          })
        )
      );

      // Prefetching all classNameIds
      classNames.forEach(getClassNameId);

      const sites = [
        ... yield session.invoke({
          "/group/get-groups": {
            companyId: session.companyId,
            parentGroupId: -1,
            site: true
          }
        }),
        ... yield session.invoke({
          "/group/get-groups": {
            companyId: session.companyId,
            parentGroupId: -1,
            site: false
          }
        })
      ];

      //for (let { friendlyURL, groupId } of sites) {
      yield map(sites, coroutine(function * ({ friendlyURL, groupId }) {

        const siteDirname = slug(friendlyURL.slice(1));

        const structures = yield session.invoke({
          "/ddmstructure/get-structures": { groupId }
        });

        const structuresDataByStructureId = {}

        //for (let structure of structures) {
        yield map(structures, coroutine(function * (structure) {
          let structureClassName;

          for (let className of classNames) {
            const classNameId = yield getClassNameId(className);

            if (structure.classNameId === classNameId) {
              structureClassName = className;
            }
          }

          if (!structureClassName) {
            console.log('Structure', friendlyURL, '- Skipping', structure.nameCurrentValue);
            return;
          }

          const humanClassName = humanClassNames[structureClassName];
          const extension = structure.storageType;
          const filename = slug(structure.nameCurrentValue);

          const dir = resolve(templatesDir, siteDirname, humanClassName);

          mkdirp.sync(dir);

          console.log('Structure', friendlyURL, '•', siteDirname, humanClassName, filename, extension);

          writeFileSync(resolve(dir, filename+'.'+extension), structure.xsd);
          writeFileSync(
            resolve(dir, filename+'.'+extension+'.json'),
            JSON.stringify(structure, null, 2)
          );

          structuresDataByStructureId[structure.structureId] = {
            structure, structureClassName, humanClassName
          };
        }));

        //for (let className of classNames) {
        yield map(classNames, coroutine(function * (className) {
          const classNameId = yield getClassNameId(className);

          const templates = yield session.invoke({
            "/ddmtemplate/get-templates": {
              groupId, classNameId
            }
          });

          //for (let template of templates) {
          yield map(templates, coroutine(function * (template) {
            const structureData = structuresDataByStructureId[template.classPK];

            const extension = template.language;
            const filename = slug(template.nameCurrentValue);

            const humanClassName =
              structureData ?
              structureData.humanClassName :
              humanClassNames[className];

            const dir = resolve(templatesDir, siteDirname, humanClassName);

            mkdirp.sync(dir);

            console.log('Template', friendlyURL, '•', siteDirname, humanClassName, filename, extension);

            writeFileSync(resolve(dir, filename+'.'+extension), template.script);
            writeFileSync(
              resolve(dir, filename+'.'+extension+'.json'),
              JSON.stringify(template, null, 2)
            );
          }));
        }));
      }));
    })();

  });

program.parse(process.argv);
