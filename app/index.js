/**
 * @format
 */
import 'react-native-get-random-values'; // crypto.getRandomValues for uuid
import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);
