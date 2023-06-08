import Handlebars from 'handlebars/runtime';
import {configureHandlebars, generate} from "./generator";
import {parseCliArguments, runGenerator} from "../../common/src/cli";

const handlebars = Handlebars.create();
configureHandlebars(handlebars);

const options = parseCliArguments([]);
runGenerator(options, generate);
